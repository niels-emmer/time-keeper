export interface Category {
  id: number;
  userId: string;
  name: string;
  color: string;
  workdayCode: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryDTO {
  name: string;
  color?: string;
  workdayCode?: string;
}

export interface UpdateCategoryDTO {
  name?: string;
  color?: string;
  workdayCode?: string | null;
  sortOrder?: number;
}
