export type CategoryTargetCadence = 'monthly' | 'weekly' | 'one_time';

export interface Category {
  id: number;
  userId: string;
  name: string;
  color: string;
  workdayCode: string | null;
  billable: boolean;
  sortOrder: number;
  targetCadence: CategoryTargetCadence | null;
  targetMinutes: number | null;
  targetStartedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryDTO {
  name: string;
  color?: string;
  workdayCode?: string;
  billable?: boolean;
  targetCadence?: CategoryTargetCadence | null;
  targetMinutes?: number | null;
}

export interface UpdateCategoryDTO {
  name?: string;
  color?: string;
  workdayCode?: string | null;
  billable?: boolean;
  sortOrder?: number;
  targetCadence?: CategoryTargetCadence | null;
  targetMinutes?: number | null;
}
