/**
 * Write tools — registered ONLY when TODOIST_READONLY=false.
 *
 * When read-only, this module's registerWriteTools is never called, so these
 * tools do not exist in the process (server-layer separation, not a client-side
 * hide). See src/index.js and the README.
 *
 * Deliberately EXCLUDED in every mode (never implemented here): delete-object,
 * manage-assignments, workspace/analytics tools, reorder/move, reminders,
 * filters. Deletion stays a manual, human-only operation.
 *
 * Tool → Todoist API v1 REST mapping (documented in README):
 *   add-tasks        POST /tasks               (one call per task)
 *   update-tasks     POST /tasks/{id}
 *   complete-tasks   POST /tasks/{id}/close
 *   uncomplete-tasks POST /tasks/{id}/reopen
 *   reschedule-tasks POST /tasks/{id}          (due_string | due_date | due_datetime)
 *   add-comments     POST /comments
 *   add-projects     POST /projects
 *   add-sections     POST /sections
 *   add-labels       POST /labels
 */
import { z } from 'zod';
import { safeField } from '../sanitize.js';
import { buildResult } from '../result.js';

const priority = z
  .number()
  .int()
  .min(1)
  .max(4)
  .optional()
  .describe('1 (normal) … 4 (urgent).');

export function registerWriteTools(server, client, cfg) {
  const registered = [];
  const add = (name, config, handler) => {
    server.registerTool(name, config, async (args) => {
      try {
        return await handler(args ?? {});
      } catch (err) {
        return buildResult(cfg, { error: err });
      }
    });
    registered.push(name);
  };

  // ---- add-tasks ------------------------------------------------------------
  add(
    'add-tasks',
    {
      title: 'Add tasks',
      description:
        'Create one or more tasks. Each maps to POST /tasks. Supply content plus any ' +
        'of: description, project_id, section_id, parent_id, labels (names), priority, ' +
        'and a due via due_string ("tomorrow 9am") or due_date (YYYY-MM-DD).',
      inputSchema: {
        tasks: z
          .array(
            z.object({
              content: z.string().min(1),
              description: z.string().optional(),
              project_id: z.string().optional(),
              section_id: z.string().optional(),
              parent_id: z.string().optional(),
              labels: z.array(z.string()).optional(),
              priority,
              due_string: z.string().optional(),
              due_date: z.string().optional(),
              due_datetime: z.string().optional(),
              deadline_date: z.string().optional(),
            })
          )
          .min(1),
      },
    },
    async (a) => {
      const results = [];
      for (const t of a.tasks) {
        const created = await client.request('POST', '/tasks', { body: t });
        results.push({
          id: created?.id,
          content: safeField(created?.content, cfg.maxFieldChars),
        });
      }
      return buildResult(cfg, { payload: { created: results.length, tasks: results } });
    }
  );

  // ---- update-tasks ---------------------------------------------------------
  add(
    'update-tasks',
    {
      title: 'Update tasks',
      description:
        'Update one or more existing tasks by id. Each maps to POST /tasks/{id}. Only ' +
        'supplied fields change. To change scheduling, prefer reschedule-tasks.',
      inputSchema: {
        tasks: z
          .array(
            z.object({
              id: z.string().min(1),
              content: z.string().optional(),
              description: z.string().optional(),
              labels: z.array(z.string()).optional(),
              priority,
              due_string: z.string().optional(),
              due_date: z.string().optional(),
              due_datetime: z.string().optional(),
              deadline_date: z.string().optional(),
            })
          )
          .min(1),
      },
    },
    async (a) => {
      const results = [];
      for (const { id, ...body } of a.tasks) {
        const updated = await client.request('POST', `/tasks/${encodeURIComponent(id)}`, {
          body,
        });
        results.push({ id, ok: true, content: safeField(updated?.content, cfg.maxFieldChars) });
      }
      return buildResult(cfg, { payload: { updated: results.length, tasks: results } });
    }
  );

  // ---- complete-tasks -------------------------------------------------------
  add(
    'complete-tasks',
    {
      title: 'Complete tasks',
      description: 'Mark tasks complete by id. Each maps to POST /tasks/{id}/close.',
      inputSchema: { ids: z.array(z.string().min(1)).min(1) },
    },
    async (a) => {
      for (const id of a.ids) {
        await client.request('POST', `/tasks/${encodeURIComponent(id)}/close`);
      }
      return buildResult(cfg, { payload: { completed: a.ids.length, ids: a.ids } });
    }
  );

  // ---- uncomplete-tasks -----------------------------------------------------
  add(
    'uncomplete-tasks',
    {
      title: 'Uncomplete tasks',
      description: 'Reopen completed tasks by id. Each maps to POST /tasks/{id}/reopen.',
      inputSchema: { ids: z.array(z.string().min(1)).min(1) },
    },
    async (a) => {
      for (const id of a.ids) {
        await client.request('POST', `/tasks/${encodeURIComponent(id)}/reopen`);
      }
      return buildResult(cfg, { payload: { reopened: a.ids.length, ids: a.ids } });
    }
  );

  // ---- reschedule-tasks -----------------------------------------------------
  add(
    'reschedule-tasks',
    {
      title: 'Reschedule tasks',
      description:
        'Change the due date/time of tasks. Each maps to POST /tasks/{id} with due fields. ' +
        'Provide due_string ("next monday"), due_date (YYYY-MM-DD), or due_datetime (RFC3339).',
      inputSchema: {
        tasks: z
          .array(
            z
              .object({
                id: z.string().min(1),
                due_string: z.string().optional(),
                due_date: z.string().optional(),
                due_datetime: z.string().optional(),
              })
              .refine(
                (t) => t.due_string || t.due_date || t.due_datetime,
                'Provide one of due_string, due_date, or due_datetime.'
              )
          )
          .min(1),
      },
    },
    async (a) => {
      const results = [];
      for (const { id, ...due } of a.tasks) {
        await client.request('POST', `/tasks/${encodeURIComponent(id)}`, { body: due });
        results.push({ id, ok: true });
      }
      return buildResult(cfg, { payload: { rescheduled: results.length, tasks: results } });
    }
  );

  // ---- add-comments ---------------------------------------------------------
  add(
    'add-comments',
    {
      title: 'Add comments',
      description:
        'Add a comment to a task or a project. Each maps to POST /comments. Exactly one ' +
        'of task_id or project_id per comment.',
      inputSchema: {
        comments: z
          .array(
            z.object({
              content: z.string().min(1),
              task_id: z.string().optional(),
              project_id: z.string().optional(),
            })
          )
          .min(1),
      },
    },
    async (a) => {
      const results = [];
      for (const c of a.comments) {
        if (!c.task_id && !c.project_id) {
          throw new Error('Each comment needs task_id or project_id.');
        }
        if (c.task_id && c.project_id) {
          throw new Error('Each comment takes only one of task_id or project_id.');
        }
        const created = await client.request('POST', '/comments', { body: c });
        results.push({ id: created?.id });
      }
      return buildResult(cfg, { payload: { added: results.length, comments: results } });
    }
  );

  // ---- add-projects ---------------------------------------------------------
  add(
    'add-projects',
    {
      title: 'Add projects',
      description: 'Create one or more projects. Each maps to POST /projects.',
      inputSchema: {
        projects: z
          .array(
            z.object({
              name: z.string().min(1),
              parent_id: z.string().optional(),
              color: z.string().optional(),
              is_favorite: z.boolean().optional(),
              view_style: z.enum(['list', 'board']).optional(),
            })
          )
          .min(1),
      },
    },
    async (a) => {
      const results = [];
      for (const p of a.projects) {
        const created = await client.request('POST', '/projects', { body: p });
        results.push({ id: created?.id, name: safeField(created?.name, cfg.maxFieldChars) });
      }
      return buildResult(cfg, { payload: { created: results.length, projects: results } });
    }
  );

  // ---- add-sections ---------------------------------------------------------
  add(
    'add-sections',
    {
      title: 'Add sections',
      description:
        'Create one or more sections within projects. Each maps to POST /sections.',
      inputSchema: {
        sections: z
          .array(
            z.object({
              name: z.string().min(1),
              project_id: z.string().min(1),
              order: z.number().int().optional(),
            })
          )
          .min(1),
      },
    },
    async (a) => {
      const results = [];
      for (const s of a.sections) {
        const created = await client.request('POST', '/sections', { body: s });
        results.push({ id: created?.id, name: safeField(created?.name, cfg.maxFieldChars) });
      }
      return buildResult(cfg, { payload: { created: results.length, sections: results } });
    }
  );

  // ---- add-labels -----------------------------------------------------------
  add(
    'add-labels',
    {
      title: 'Add labels',
      description: 'Create one or more personal labels. Each maps to POST /labels.',
      inputSchema: {
        labels: z
          .array(
            z.object({
              name: z.string().min(1),
              color: z.string().optional(),
              is_favorite: z.boolean().optional(),
              order: z.number().int().optional(),
            })
          )
          .min(1),
      },
    },
    async (a) => {
      const results = [];
      for (const l of a.labels) {
        const created = await client.request('POST', '/labels', { body: l });
        results.push({ id: created?.id, name: safeField(created?.name, cfg.maxFieldChars) });
      }
      return buildResult(cfg, { payload: { created: results.length, labels: results } });
    }
  );

  return registered;
}
