import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WeeklyGoalSetting } from '../WeeklyGoalSetting';

const { useSettingsMock, updateMutateMock } = vi.hoisted(() => ({
  useSettingsMock: vi.fn(),
  updateMutateMock: vi.fn(),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => useSettingsMock(),
  useUpdateSettings: () => ({ mutate: updateMutateMock, isPending: false }),
}));

describe('WeeklyGoalSetting timezone selector (P2-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsMock.mockReturnValue({
      data: {
        weeklyGoalHours: 32,
        roundingIncrementMinutes: 30,
        timezone: 'Europe/Amsterdam',
      },
      isLoading: false,
    });
  });

  it('shows the saved timezone', () => {
    render(<WeeklyGoalSetting />);

    const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
    expect(select.value).toBe('Europe/Amsterdam');
  });

  it('saves the selected timezone with the other settings', () => {
    render(<WeeklyGoalSetting />);

    fireEvent.change(screen.getByLabelText('Time zone'), {
      target: { value: 'America/New_York' },
    });

    expect(updateMutateMock).toHaveBeenCalledWith({
      weeklyGoalHours: 32,
      roundingIncrementMinutes: 30,
      timezone: 'America/New_York',
    });
  });
});
