import type {
  Category,
  CreateCategoryDTO,
  UpdateCategoryDTO,
  TimeEntry,
  WeeklySummary,
  RoundingResult,
} from '@time-keeper/shared';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Categories
export const api = {
  categories: {
    list: () => request<Category[]>('/categories'),
    create: (dto: CreateCategoryDTO) =>
      request<Category>('/categories', { method: 'POST', body: JSON.stringify(dto) }),
    update: (id: number, dto: UpdateCategoryDTO) =>
      request<Category>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
    delete: (id: number) =>
      request<void>(`/categories/${id}`, { method: 'DELETE' }),
  },

  timer: {
    status: () => request<{ active: false } | { active: true; entry: TimeEntry }>('/timer'),
    start: (categoryId: number) =>
      request<TimeEntry>('/timer/start', { method: 'POST', body: JSON.stringify({ categoryId }) }),
    stop: () => request<TimeEntry>('/timer/stop', { method: 'POST', body: JSON.stringify({}) }),
  },

  entries: {
    listByDate: (date: string) => request<TimeEntry[]>(`/entries?date=${date}`),
    listByWeek: (week: string) => request<TimeEntry[]>(`/entries?week=${week}`),
    update: (id: number, dto: Partial<TimeEntry>) =>
      request<TimeEntry>(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
    delete: (id: number) =>
      request<void>(`/entries/${id}`, { method: 'DELETE' }),
  },

  summary: {
    weekly: (week?: string) =>
      request<WeeklySummary>(`/summary/weekly${week ? `?week=${week}` : ''}`),
    round: (date: string) =>
      request<RoundingResult>('/summary/round', { method: 'POST', body: JSON.stringify({ date }) }),
  },

  info: {
    get: () => request<{ version: string; repoUrl: string; user: string }>('/info'),
  },
} as const;
