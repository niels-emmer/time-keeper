export interface Category {
  id: number;
  userId: string;
  name: string;
  color: string;
  workdayCode: string | null;
  bonus: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryDTO {
  name: string;
  color?: string;
  workdayCode?: string;
  bonus?: boolean;
}

export interface UpdateCategoryDTO {
  name?: string;
  color?: string;
  workdayCode?: string | null;
  bonus?: boolean;
  sortOrder?: number;
}
