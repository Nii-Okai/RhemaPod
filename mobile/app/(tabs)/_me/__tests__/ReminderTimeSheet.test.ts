import { setPeriod, stepHour, stepMinute } from '../ReminderTimeSheet';

describe('reminder time stepping', () => {
  it('steps hours around the 12-hour face without flipping AM/PM', () => {
    expect(stepHour({ hour: 11, minute: 0 }, 1)).toEqual({ hour: 0, minute: 0 });
    expect(stepHour({ hour: 0, minute: 0 }, -1)).toEqual({ hour: 11, minute: 0 });
    expect(stepHour({ hour: 23, minute: 0 }, 1)).toEqual({ hour: 12, minute: 0 });
    expect(stepHour({ hour: 12, minute: 0 }, -1)).toEqual({ hour: 23, minute: 0 });
    expect(stepHour({ hour: 7, minute: 0 }, 1)).toEqual({ hour: 8, minute: 0 });
  });

  it('steps minutes in fives, snapping odd minutes and wrapping within the hour', () => {
    expect(stepMinute({ hour: 7, minute: 0 }, 1)).toEqual({ hour: 7, minute: 5 });
    expect(stepMinute({ hour: 7, minute: 0 }, -1)).toEqual({ hour: 7, minute: 55 });
    expect(stepMinute({ hour: 7, minute: 55 }, 1)).toEqual({ hour: 7, minute: 0 });
    expect(stepMinute({ hour: 7, minute: 3 }, 1)).toEqual({ hour: 7, minute: 5 });
    expect(stepMinute({ hour: 7, minute: 3 }, -1)).toEqual({ hour: 7, minute: 0 });
  });

  it('switches AM and PM', () => {
    expect(setPeriod({ hour: 7, minute: 0 }, 'PM')).toEqual({ hour: 19, minute: 0 });
    expect(setPeriod({ hour: 19, minute: 0 }, 'AM')).toEqual({ hour: 7, minute: 0 });
    expect(setPeriod({ hour: 0, minute: 0 }, 'PM')).toEqual({ hour: 12, minute: 0 });
    expect(setPeriod({ hour: 7, minute: 0 }, 'AM')).toEqual({ hour: 7, minute: 0 });
  });
});
