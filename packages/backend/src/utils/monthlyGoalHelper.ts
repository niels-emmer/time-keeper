
// packages/backend/src/utils/monthlyGoalHelper.ts

import { db } from '../db/client.js'; // Assuming 'db' is the configured Drizzle client instance
import { monthlyProjectGoals } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

/**
 * Normalizes a date string (e.g., "2026-05-15") to a 'YYYY-MM' format.
 * @param dateStr - The full date string.
 * @returns The YYYY-MM string (e.g., '2026-05') or null if parsing fails.
 */
export function normalizeMonthYear(dateStr: string): string | null {
    if (!dateStr) return null;
    try {
        // Uses Date.toISOString to ensure consistent format generation from local input
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        
        const year = date.getFullYear().toString();
        // Month is 0-indexed, so we add 1. PadStart ensures '01', '02', etc.
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    } catch (e) {
        console.error("Failed to normalize month year:", e);
        return null;
    }
}

/**
 * Fetches the monthly goal for a specific category and user for a given month/year.
 * @param userId The ID of the user.
 * @param categoryId The ID of the category.
 * @param monthYear The target YYYY-MM string.
 * @returns The goal data, or null if not found.
 */
export async function getMonthlyGoal(userId: string, categoryId: number, monthYear: string): Promise<{ availableHours: number; availableMinutes: number } | null> {
    try {
        const goalRecord = await db.select({
            availableHours: monthlyProjectGoals.availableHours,
            availableMinutes: monthlyProjectGoals.availableMinutes
        }).from(monthlyProjectGoals).where(
            and(
                eq(monthlyProjectGoals.userId, userId),
                eq(monthlyProjectGoals.categoryId, categoryId),
                eq(monthlyProjectGoals.monthYear, monthYear)
            )
        ).limit(1);

        if (goalRecord.length > 0) {
            return goalRecord[0];
        }
        return null;
    } catch (error) {
        console.error("Error fetching monthly goal:", error);
        throw new Error("Database error while retrieving monthly goal.");
    }
}

/**
 * Sets or updates the monthly goal for a category. This acts as an upsert.
 * @param userId The ID of the user.
 * @param categoryId The ID of the category.
 * @param monthYear The target YYYY-MM string.
 * @param hours Available hours.
 * @param minutes Available minutes.
 */
export async function setMonthlyGoal(userId: string, categoryId: number, monthYear: string, hours: number, minutes: number) {
    try {
        // 1. Check if a record exists
        const existingGoal = await db.select({ id: monthlyProjectGoals.id }).from(monthlyProjectGoals)
            .where(and(
                eq(monthlyProjectGoals.userId, userId),
                eq(monthlyProjectGoals.categoryId, categoryId),
                eq(monthlyProjectGoals.monthYear, monthYear)
            )).limit(1);

        if (existingGoal.length > 0) {
            // 2. Update existing record (UPSERT)
            await db.update(monthlyProjectGoals)
                .set({
                    availableHours: hours,
                    availableMinutes: minutes,
                    lastUpdated: new Date().toISOString(),
                })
                .where(and(
                    eq(monthlyProjectGoals.userId, userId),
                    eq(monthlyProjectGoals.categoryId, categoryId),
                    eq(monthlyProjectGoals.monthYear, monthYear)
                ));
        } else {
            // 3. Insert new record
            await db.insert(monthlyProjectGoals).values({
                userId: userId,
                categoryId: categoryId,
                monthYear: monthYear,
                availableHours: hours,
                availableMinutes: minutes,
                lastUpdated: new Date().toISOString(),
            }).onConflictDoNothing(); // Prevents failure if race condition occurs
        }
    } catch (error) {
        console.error("Error setting monthly goal:", error);
        throw new Error("Failed to set monthly goal due to a database error.");
    }
}
