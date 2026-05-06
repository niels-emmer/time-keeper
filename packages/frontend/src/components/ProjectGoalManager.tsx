
// packages/frontend/src/components/ProjectGoalManager.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

// Assume a Context or global state provides the required categoryId and userId
interface GoalContextType {
    categoryId: number;
    userId: string;
}

interface ProjectGoalManagerProps {
    context: GoalContextType;
}

export function ProjectGoalManager({ context }: ProjectGoalManagerProps) {
    const { categoryId } = context;
    
    const [monthYear, setMonthYear] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
    const [availableHours, setAvailableHours] = useState(40);
    const [availableMinutes, setAvailableMinutes] = useState(2400);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    // Fetch the current goal when the component mounts
    useEffect(() => {
        fetchGoals();
    }, [categoryId]);

    const fetchGoals = async () => {
        setMessage("Loading current month's goals...");
        try {
            const data = await api.monthlyGoals.get(categoryId, monthYear);
            if (data.goal) {
                setMessage(`Current goal retrieved: ${data.goal.availableHours}h / ${data.goal.availableMinutes}min.`);
            } else {
                setMessage("No specific goal set for this month. Please set one below.");
            }
        } catch (error) {
            setMessage("Failed to fetch goals.");
            console.error("Fetch goal error:", error);
        }
    };

    const handleSave = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const data = await api.monthlyGoals.set({
                categoryId,
                monthYear,
                availableHours,
                availableMinutes: Math.max(1, availableMinutes),
            });
            setMessage(`Success: ${data.message}`);
        } catch (error) {
            setMessage(`Error saving goal: ${error instanceof Error ? error.message : 'Unknown API Error'}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>📊 Monthly Goal Planning</CardTitle>
                <p className="text-sm text-muted-foreground">Define resource limits for this project for a given month.</p>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Month Year Selector (Simplified for component mock) */}
                    <div>
                        <label htmlFor="monthYear" className="text-sm font-medium">Month / Year</label>
                        <Input 
                            id="monthYear" 
                            value={monthYear} 
                            onChange={(e) => setMonthYear(e.target.value)} 
                            placeholder="YYYY-MM"
                        />
                    </div>
                    {/* Available Hours */}
                    <div>
                        <label htmlFor="availableHours" className="text-sm font-medium">Available Hours</label>
                        <div className="flex space-x-2">
                            <Input 
                                id="availableHours" 
                                type="number"
                                value={availableHours} 
                                onChange={(e) => setAvailableHours(Number(e.target.value))} 
                                min="0"
                                placeholder="e.g. 160"
                                className="flex-grow"
                            />
                            {/* Placeholder for "Copy from previous month" button */}
                            <Button variant="outline" disabled={false}>Copy</Button>
                        </div>
                    </div>
                    {/* Available Minutes */}
                    <div>
                        <label htmlFor="availableMinutes" className="text-sm font-medium">Available Minutes</label>
                        <div className="flex space-x-2">
                            <Input 
                                id="availableMinutes" 
                                type="number"
                                value={availableMinutes} 
                                onChange={(e) => setAvailableMinutes(Number(e.target.value))} 
                                min="0"
                                placeholder="e.g. 960"
                                className="flex-grow"
                            />
                        </div>
                    </div>
                </div>
                
                {/* Buttons */}
                <Button onClick={handleSave} disabled={loading || !monthYear} className="w-full mt-4">
                    {loading ? 'Saving...' : 'Save Monthly Goal'}
                </Button>
                <p className={`text-center text-sm mt-2 ${message ? (message.includes('Success') ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground'}`}>
                    {message}
                </p>
            </CardContent>
        </Card>
    );
}
