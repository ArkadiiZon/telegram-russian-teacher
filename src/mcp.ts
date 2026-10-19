import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { authenticate, authorize } from './auth';
import { AppError, type Env, type Scope } from './types';
import { Store } from './store';
import { configPatch, groupId, lessonContent, quizContent } from './validation';
@Injectable()
export class McpEndpoint {
  constructor(private env: Env, private store: Store) {}
  async handle(request: Request) {
    const principal = await authenticate(request, this.env);
    const server = new McpServer({ name: 'russian-teacher', version: '0.1.0' });
    const register = (name: string, description: string, scope: Scope, shape: z.ZodRawShape, readOnly: boolean,
      action: (args: Record<string, any>) => Promise<unknown>) => {
      if (!principal.scopes.includes(scope)) return;
      server.registerTool(name, {
        description, inputSchema: { group_id: groupId, ...shape },
        annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: !readOnly },
        _meta: { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] }
      }, async (args: Record<string, any>) => {
        try {
          authorize(principal, args.group_id, scope);
          const result = await action(args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text' as const, text: error instanceof AppError ? error.code : error instanceof z.ZodError ? 'invalid_arguments' : 'operation_failed' }] };
        }
      });
    };
    // No group ID is inferred from a model's claims; every call checks the issued grant.
    register('get_group_config', 'Read configuration for your authorized Telegram group.', 'config:read', {}, true,
      a => this.store.group(a.group_id));
    register('update_group_config', 'Set timezone, daily lesson/quiz times, level, or pause. Times use the group IANA timezone.',
      'config:write', { patch: configPatch }, false, a => this.store.updateGroup(a.group_id, a.patch));
    register('schedule_lesson', 'Schedule a Russian lesson or quiz authored by ChatGPT. Content is required. Reuse the same idempotency_key when retrying.',
      'lessons:write', {
        kind: z.enum(['lesson', 'quiz']), topic: z.string().min(1).max(160),
        publish_at: z.string().datetime({ offset: true }), idempotency_key: z.string().min(8).max(120).regex(/^[a-zA-Z0-9:_-]+$/),
        content: z.union([lessonContent, quizContent])
      }, false, async a => {
        if (a.idempotency_key.startsWith('daily:')) throw new AppError('reserved_idempotency_key');
        const when = Date.parse(a.publish_at);
        if (when < Date.now() - 300_000 || when > Date.now() + 366 * 86_400_000) throw new AppError('invalid_schedule_time');
        const content = (a.kind === 'lesson' ? lessonContent : quizContent).parse(a.content);
        const lesson = await this.store.schedule(a.group_id, a.kind, a.topic, when, `manual:${a.idempotency_key}`, content);
        return { id: lesson.id, status: lesson.status, publish_at: new Date(lesson.publish_at).toISOString() };
      });
    register('list_lessons', 'List the latest 50 scheduled lessons and delivery states in your group.', 'lessons:read', {}, true,
      a => this.store.list(a.group_id));
    register('get_lesson', 'Read saved lesson or quiz content in your group to prepare follow-up exercises.',
      'lessons:read', { lesson_id: z.string().uuid() }, true, a => this.store.lesson(a.group_id, a.lesson_id));
    register('post_lesson', 'Queue an existing pending lesson for publication on the next BullMQ delivery tick. This posts to Telegram; the group must be enabled.',
      'lessons:post', { lesson_id: z.string().uuid() }, false, a => this.store.post(a.group_id, a.lesson_id));
    register('get_progress', 'Get aggregate quiz progress, optionally limited to one Telegram user ID, within the authorized group.',
      'progress:read', { user_id: z.string().regex(/^\d{1,20}$/).optional() }, true,
      a => this.store.progress(a.group_id, a.user_id));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    // JSON responses are fully handled before closing the per-request stateless server.
    try { return await transport.handleRequest(request); }
    finally { await server.close(); }
  }
}
