export interface TimeEntry {
  id: number;
  userId: string;
  categoryId: number;
  startTime: string; // UTC ISO 8601
  endTime: string | null; // null = timer running
  notes: string | null;
  rounded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntryDTO {
  categoryId: number;
  startTime?: string;
  notes?: string;
}

export interface UpdateEntryDTO {
  categoryId?: number;
  startTime?: string;
  endTime?: string | null;
  notes?: string | null;
}
