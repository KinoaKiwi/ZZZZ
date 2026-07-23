import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../core/theme/app_colors.dart';
import '../../data/models/chat_message.dart';
import '../../data/models/profile.dart';
import '../../data/repositories/chat_repository.dart';
import '../../data/repositories/group_repository.dart';

/// Chat privé du groupe : messages, photos, positions, lieux — en temps réel.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.groupId});

  final String groupId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _textCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  bool _sending = false;

  @override
  void dispose() {
    _textCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendText() async {
    final body = _textCtrl.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ref.read(chatRepositoryProvider).sendText(widget.groupId, body);
      _textCtrl.clear();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendPhoto() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
      imageQuality: 85,
    );
    if (picked == null) return;
    await ref.read(chatRepositoryProvider).sendPhoto(widget.groupId, File(picked.path));
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(chatMessagesProvider(widget.groupId));
    final myId = ref.watch(currentUserProvider)?.id;
    final members = ref.watch(groupProfilesProvider(widget.groupId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat du groupe'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/map/${widget.groupId}'),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: messages.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('Erreur : $e')),
              data: (list) {
                // Défile vers le bas à l'arrivée de nouveaux messages.
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (_scrollCtrl.hasClients) {
                    _scrollCtrl.jumpTo(_scrollCtrl.position.maxScrollExtent);
                  }
                });
                return ListView.builder(
                  controller: _scrollCtrl,
                  padding: const EdgeInsets.all(12),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final msg = list[i];
                    final profile = members.valueOrNull?[msg.authorId];
                    return _MessageBubble(
                      message: msg,
                      author: profile,
                      isMine: msg.authorId == myId,
                    );
                  },
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.photo, color: AppColors.neonMagenta),
                    onPressed: _sendPhoto,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _textCtrl,
                      decoration: const InputDecoration(hintText: 'Message…'),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendText(),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    icon: const Icon(Icons.send, color: AppColors.neonCyan),
                    onPressed: _sending ? null : _sendText,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageBubble extends ConsumerWidget {
  const _MessageBubble({
    required this.message,
    required this.author,
    required this.isMine,
  });

  final ChatMessage message;
  final Profile? author;
  final bool isMine;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = author != null
        ? AppColors.fromHex(author!.color)
        : AppColors.textSecondary;

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: const BoxConstraints(maxWidth: 280),
        decoration: BoxDecoration(
          color: isMine ? AppColors.surfaceHigh : AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity(0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isMine)
              Text(
                author?.displayName ?? '…',
                style: TextStyle(
                  color: color,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            _content(ref),
            const SizedBox(height: 2),
            Text(
              DateFormat.Hm().format(message.createdAt.toLocal()),
              style: const TextStyle(color: AppColors.textFaint, fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }

  Widget _content(WidgetRef ref) {
    switch (message.kind) {
      case MessageKind.text:
        return Text(message.body ?? '');
      case MessageKind.photo:
        return _ChatPhoto(storagePath: message.body ?? '');
      case MessageKind.location:
        final p = message.position;
        return Text(
          p == null ? '📍 Position' : '📍 ${p.lat.toStringAsFixed(5)}, ${p.lng.toStringAsFixed(5)}',
        );
      case MessageKind.poi:
        return const Text('📌 Lieu partagé');
    }
  }
}

class _ChatPhoto extends ConsumerWidget {
  const _ChatPhoto({required this.storagePath});

  final String storagePath;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final url = ref.watch(_chatImageUrlProvider(storagePath));
    return url.when(
      loading: () => const SizedBox(
        height: 120,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      ),
      error: (_, __) => const Text('🖼️ (photo indisponible)'),
      data: (u) => ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Image.network(u, height: 180, fit: BoxFit.cover),
      ),
    );
  }
}

final _chatImageUrlProvider =
    FutureProvider.family<String, String>((ref, path) {
  return ref.watch(chatRepositoryProvider).signedImageUrl(path);
});
