/**
 * Read tools — registered in ALL modes (read-only and read/write).
 *
 * Tool → Todoist API v1 REST mapping (documented in README):
 *   find-tasks         GET /tasks           | GET /tasks/filter?query=
 *   find-tasks-by-date GET /tasks/filter?query=<date filter>
 *   find-projects      GET /projects
 *   find-sections      GET /sections[?project_id=]
 *   find-labels        GET /labels
 *   find-comments      GET /comments?task_id= | ?project_id=
 *   get-overview       GET /projects + /sections + /labels + /tasks
 *                      + GET /tasks/filter?query=today | ?query=overdue (aggregated)
 */
import { z } from 'zod';
import {
  shapeTask,
  shapeProject,
  shapeSection,
  shapeLabel,
  shapeComment,
} from '../shape.js';
import { buildResult } from '../result.js';

/**
 * Fixed ceiling for get-overview's tasks, today and overdue fetches (D-1,
 * D-2). Deliberately not configurable and not TODOIST_MAX_ITEMS: see the
 * comment in the handler.
 */
export const OVERVIEW_MAX_ITEMS = 5000;

export function registerReadTools(server, client, cfg) {
  const registered = [];
  const add = (name, config, handler) => {
    server.registerTool(name, config, async (args) => {
      try {
        return await handler(args ?? {});
      } catch (err) {
        // Error message is already redacted at the client layer; buildResult
        // applies a belt-and-suspenders redaction pass regardless.
        return buildResult(cfg, { error: err });
      }
    });
    registered.push(name);
  };

  // ---- find-tasks -----------------------------------------------------------
  add(
    'find-tasks',
    {
      title: 'Find tasks',
      description:
        'List active tasks. Provide a Todoist filter `query` (e.g. "today | overdue", ' +
        '"#Work & %next") for advanced searches, or narrow by project_id / section_id / ' +
        'label / parent_id / ids. A non-empty `query` replaces project_id, section_id, ' +
        'label, parent_id and ids. To combine a project, section or label with a query, ' +
        'put it in the query by name (#Project, /Section, %label); the query cannot ' +
        'select by parent_id or ids, so omit `query` to use them. Results are paginated ' +
        'and size-capped.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Todoist filter query. When set, uses GET /tasks/filter.'),
        project_id: z
          .string()
          .optional()
          .describe(
            'Project id. A non-empty `query` replaces this filter; to combine them, ' +
              'put the project in the query by name (#Project).'
          ),
        section_id: z
          .string()
          .optional()
          .describe(
            'Section id. A non-empty `query` replaces this filter; to combine them, ' +
              'put the section in the query by name (/Section).'
          ),
        label: z
          .string()
          .optional()
          .describe(
            'Label NAME (not id). A non-empty `query` replaces this filter; to combine ' +
              'them, put the label in the query (%label).'
          ),
        parent_id: z
          .string()
          .optional()
          .describe(
            'Parent task id. A non-empty `query` replaces this filter. The query syntax ' +
              'cannot select by parent task, so to filter by it, omit `query`.'
          ),
        ids: z
          .array(z.string())
          .optional()
          .describe(
            'Specific task ids. A non-empty `query` replaces this filter. The query ' +
              'syntax cannot select by task id, so to filter by these, omit `query`.'
          ),
        limit: z.number().int().positive().optional(),
      },
    },
    async (a) => {
      const cap = a.limit ?? cfg.maxItems;
      let items, truncated;
      if (a.query && a.query.trim() !== '') {
        ({ items, truncated } = await client.getPaginated(
          '/tasks/filter',
          { query: a.query, lang: 'en' },
          cap
        ));
      } else {
        ({ items, truncated } = await client.getPaginated(
          '/tasks',
          {
            project_id: a.project_id,
            section_id: a.section_id,
            label: a.label,
            parent_id: a.parent_id,
            ids: a.ids?.join(','),
          },
          cap
        ));
      }
      return buildResult(cfg, {
        payload: { count: items.length, truncated, tasks: items.map((t) => shapeTask(t, cfg)) },
      });
    }
  );

  // ---- find-tasks-by-date ---------------------------------------------------
  add(
    'find-tasks-by-date',
    {
      title: 'Find tasks by date',
      description:
        'Find active tasks by due date. Use `preset` for common views ' +
        '(today, overdue, next7days, nodate, recurring) or supply a `date` (YYYY-MM-DD ' +
        'or natural language like "next monday") with `comparison` (on | before | after). ' +
        'Implemented via GET /tasks/filter.',
      inputSchema: {
        preset: z
          .enum(['today', 'overdue', 'next7days', 'nodate', 'recurring'])
          .optional(),
        date: z.string().optional().describe('A date, e.g. 2026-07-25 or "next monday".'),
        comparison: z.enum(['on', 'before', 'after']).default('on').optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (a) => {
      let query;
      if (a.preset) {
        query = {
          today: 'today | overdue',
          overdue: 'overdue',
          next7days: 'next 7 days',
          nodate: 'no date',
          recurring: 'recurring',
        }[a.preset];
      } else if (a.date) {
        const cmp = a.comparison ?? 'on';
        query =
          cmp === 'before'
            ? `due before: ${a.date}`
            : cmp === 'after'
              ? `due after: ${a.date}`
              : `due: ${a.date}`;
      } else {
        throw new Error('Provide either `preset` or `date`.');
      }
      const { items, truncated } = await client.getPaginated(
        '/tasks/filter',
        { query, lang: 'en' },
        a.limit ?? cfg.maxItems
      );
      return buildResult(cfg, {
        payload: {
          filter: query,
          count: items.length,
          truncated,
          tasks: items.map((t) => shapeTask(t, cfg)),
        },
      });
    }
  );

  // ---- find-projects --------------------------------------------------------
  add(
    'find-projects',
    {
      title: 'Find projects',
      description: 'List all projects. Implemented via GET /projects.',
      inputSchema: { limit: z.number().int().positive().optional() },
    },
    async (a) => {
      const { items, truncated } = await client.getPaginated(
        '/projects',
        {},
        a.limit ?? cfg.maxItems
      );
      return buildResult(cfg, {
        payload: {
          count: items.length,
          truncated,
          projects: items.map((p) => shapeProject(p, cfg)),
        },
      });
    }
  );

  // ---- find-sections --------------------------------------------------------
  add(
    'find-sections',
    {
      title: 'Find sections',
      description:
        'List sections, optionally scoped to a project_id. Implemented via GET /sections.',
      inputSchema: {
        project_id: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (a) => {
      const { items, truncated } = await client.getPaginated(
        '/sections',
        { project_id: a.project_id },
        a.limit ?? cfg.maxItems
      );
      return buildResult(cfg, {
        payload: {
          count: items.length,
          truncated,
          sections: items.map((s) => shapeSection(s, cfg)),
        },
      });
    }
  );

  // ---- find-labels ----------------------------------------------------------
  add(
    'find-labels',
    {
      title: 'Find labels',
      description: 'List all personal labels. Implemented via GET /labels.',
      inputSchema: { limit: z.number().int().positive().optional() },
    },
    async (a) => {
      const { items, truncated } = await client.getPaginated(
        '/labels',
        {},
        a.limit ?? cfg.maxItems
      );
      return buildResult(cfg, {
        payload: { count: items.length, truncated, labels: items.map((l) => shapeLabel(l, cfg)) },
      });
    }
  );

  // ---- find-comments --------------------------------------------------------
  add(
    'find-comments',
    {
      title: 'Find comments',
      description:
        'List comments for a task (task_id) or a project (project_id). Exactly one is ' +
        'required. Implemented via GET /comments.',
      inputSchema: {
        task_id: z.string().optional(),
        project_id: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async (a) => {
      if (!a.task_id && !a.project_id) {
        throw new Error('Provide either task_id or project_id.');
      }
      if (a.task_id && a.project_id) {
        throw new Error('Provide only one of task_id or project_id, not both.');
      }
      const { items, truncated } = await client.getPaginated(
        '/comments',
        { task_id: a.task_id, project_id: a.project_id },
        a.limit ?? cfg.maxItems
      );
      return buildResult(cfg, {
        payload: {
          count: items.length,
          truncated,
          comments: items.map((c) => shapeComment(c, cfg)),
        },
      });
    }
  );

  // ---- get-overview ---------------------------------------------------------
  add(
    'get-overview',
    {
      title: 'Get overview',
      description:
        'A compact GTD overview: projects with active-task counts, section names, label ' +
        'names, and counts of tasks due today / overdue. Aggregates GET /projects, ' +
        '/sections, /labels, /tasks and /tasks/filter. due_today and overdue come from Todoist\'s ' +
        'own "today" and "overdue" filters, evaluated in the Todoist account\'s ' +
        'timezone. Task counts cover up to 5000 tasks each; ' +
        'project, section and label lists follow the normal item cap. Each count is ' +
        '{ count, is_floor }: when is_floor is true the count is a minimum, not exact. ' +
        'Size-capped.',
      inputSchema: {},
    },
    async () => {
      // Tasks are only counted, never returned, so counting more of them does
      // not widen the untrusted text reaching the agent (D-1). Projects,
      // sections and labels return attacker-writable names and keep the
      // configured cap. "Today" is Todoist's, in the account's timezone: the
      // server holds no clock or timezone for it (D-2).
      const [projRes, secRes, labelRes, taskRes, todayRes, overdueRes] = await Promise.all([
        client.getPaginated('/projects', {}, cfg.maxItems),
        client.getPaginated('/sections', {}, cfg.maxItems),
        client.getPaginated('/labels', {}, cfg.maxItems),
        client.getPaginated('/tasks', {}, OVERVIEW_MAX_ITEMS),
        client.getPaginated('/tasks/filter', { query: 'today', lang: 'en' }, OVERVIEW_MAX_ITEMS),
        client.getPaginated('/tasks/filter', { query: 'overdue', lang: 'en' }, OVERVIEW_MAX_ITEMS),
      ]);
      const counted = (count, res) => ({ count, is_floor: res.truncated });

      const projectIds = new Set(projRes.items.map((p) => p.id));
      const sectionsByProject = new Map();
      const unmatchedSections = [];
      for (const s of secRes.items) {
        const shaped = shapeSection(s, cfg);
        if (!projectIds.has(s.project_id)) {
          unmatchedSections.push({ project_id: shaped.project_id, name: shaped.name });
          continue;
        }
        if (!sectionsByProject.has(s.project_id)) sectionsByProject.set(s.project_id, []);
        sectionsByProject.get(s.project_id).push(shaped.name);
      }

      const counts = new Map();
      let unlistedTasks = 0;
      for (const t of taskRes.items) {
        if (projectIds.has(t.project_id)) {
          counts.set(t.project_id, (counts.get(t.project_id) ?? 0) + 1);
        } else {
          unlistedTasks += 1;
        }
      }

      const projects = projRes.items.map((p) => {
        const shaped = shapeProject(p, cfg);
        return {
          id: shaped.id,
          name: shaped.name,
          is_inbox_project: shaped.is_inbox_project,
          active_task_count: counted(counts.get(p.id) ?? 0, taskRes),
          sections: sectionsByProject.get(p.id) ?? [],
        };
      });

      const fetches = {
        projects: { fetched: projRes.items.length, truncated: projRes.truncated },
        sections: { fetched: secRes.items.length, truncated: secRes.truncated },
        labels: { fetched: labelRes.items.length, truncated: labelRes.truncated },
        tasks: { fetched: taskRes.items.length, truncated: taskRes.truncated },
        due_today: { fetched: todayRes.items.length, truncated: todayRes.truncated },
        overdue: { fetched: overdueRes.items.length, truncated: overdueRes.truncated },
      };
      const warnings = [];
      if (projRes.truncated) {
        warnings.push(
          `projects fetch was truncated at ${fetches.projects.fetched} items; totals.projects ` +
            'is a floor, and unlisted projects\' sections and tasks appear under ' +
            'unmatched_sections and tasks_in_unlisted_projects.'
        );
      }
      if (secRes.truncated) {
        warnings.push(
          `sections fetch was truncated at ${fetches.sections.fetched} items; ` +
            'section lists and unmatched_sections may be incomplete.'
        );
      }
      if (labelRes.truncated) {
        warnings.push(
          `labels fetch was truncated at ${fetches.labels.fetched} items; totals.labels ` +
            'is a floor and the labels list is incomplete.'
        );
      }
      if (taskRes.truncated) {
        warnings.push(
          `tasks fetch was truncated at ${fetches.tasks.fetched} items; active_tasks, ` +
            "tasks_in_unlisted_projects and every project's active_task_count are " +
            'floors (at least this many), not exact.'
        );
      }
      if (todayRes.truncated) {
        warnings.push(
          `today filter fetch was truncated at ${fetches.due_today.fetched} items; ` +
            'totals.due_today is a floor, not exact.'
        );
      }
      if (overdueRes.truncated) {
        warnings.push(
          `overdue filter fetch was truncated at ${fetches.overdue.fetched} items; ` +
            'totals.overdue is a floor, not exact.'
        );
      }

      // Signal keys come before the name lists: capOutput cuts from the end.
      return buildResult(cfg, {
        payload: {
          fetches,
          ...(warnings.length > 0 ? { warnings } : {}),
          totals: {
            projects: counted(projRes.items.length, projRes),
            active_tasks: counted(taskRes.items.length, taskRes),
            labels: counted(labelRes.items.length, labelRes),
            due_today: counted(todayRes.items.length, todayRes),
            overdue: counted(overdueRes.items.length, overdueRes),
          },
          tasks_in_unlisted_projects: counted(unlistedTasks, taskRes),
          unmatched_sections: unmatchedSections,
          labels: labelRes.items.map((l) => shapeLabel(l, cfg).name),
          projects,
        },
      });
    }
  );

  return registered;
}
