/**
 * Shaping helpers: convert raw Todoist API objects into compact result objects,
 * routing every untrusted text field through safeField (frame + strip) and
 * passing through only the structural/scalar fields the agent needs.
 *
 * Untrusted fields (per the build brief): task content & description, comment
 * content, project/section/label names, and free-text due strings.
 */
import { safeField } from './sanitize.js';

function frameLabels(labels, maxFieldChars) {
  if (!Array.isArray(labels)) return [];
  return labels.map((l) => safeField(l, maxFieldChars)).filter(Boolean);
}

function shapeDue(due, maxFieldChars) {
  if (!due || typeof due !== 'object') return null;
  return {
    date: due.date ?? null,
    datetime: due.datetime ?? null,
    timezone: due.timezone ?? null,
    is_recurring: due.is_recurring ?? false,
    string: safeField(due.string, maxFieldChars) || null,
  };
}

export function shapeTask(t, cfg) {
  const m = cfg.maxFieldChars;
  return {
    id: t.id,
    content: safeField(t.content, m),
    description: safeField(t.description, m) || null,
    project_id: t.project_id ?? null,
    section_id: t.section_id ?? null,
    parent_id: t.parent_id ?? null,
    priority: t.priority ?? null,
    labels: frameLabels(t.labels, m),
    due: shapeDue(t.due, m),
    deadline: t.deadline?.date ?? null,
    is_completed: t.is_completed ?? t.checked ?? false,
    created_at: t.created_at ?? t.added_at ?? null,
    completed_at: t.completed_at ?? null,
  };
}

export function shapeProject(p, cfg) {
  const m = cfg.maxFieldChars;
  return {
    id: p.id,
    name: safeField(p.name, m),
    parent_id: p.parent_id ?? null,
    is_inbox_project: p.is_inbox_project ?? p.inbox_project ?? false,
    is_favorite: p.is_favorite ?? false,
    is_archived: p.is_archived ?? false,
    color: p.color ?? null,
    view_style: p.view_style ?? null,
  };
}

export function shapeSection(s, cfg) {
  const m = cfg.maxFieldChars;
  return {
    id: s.id,
    name: safeField(s.name, m),
    project_id: s.project_id ?? null,
    order: s.section_order ?? s.order ?? null,
  };
}

export function shapeLabel(l, cfg) {
  const m = cfg.maxFieldChars;
  return {
    id: l.id,
    name: safeField(l.name, m),
    color: l.color ?? null,
    is_favorite: l.is_favorite ?? false,
    order: l.order ?? null,
  };
}

export function shapeComment(c, cfg) {
  const m = cfg.maxFieldChars;
  return {
    id: c.id,
    content: safeField(c.content, m),
    task_id: c.task_id ?? null,
    project_id: c.project_id ?? null,
    posted_at: c.posted_at ?? c.posted ?? null,
    // Attachments carry third-party filenames/URLs: frame the name, drop URL.
    attachment: c.attachment
      ? { file_name: safeField(c.attachment.file_name, m) || null }
      : null,
  };
}
