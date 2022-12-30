import {
  getPrayerTimes,
  isMinimumSettingsAvailable,
  Prayer,
  PrayersInOrder,
} from '@/adhan';
import {alarmSettings, getAdhanSettingKey} from '@/store/alarm_settings';
import {calcSettings} from '@/store/calculation_settings';
import {addDays} from '@/utils/date';

const timezone_mock = require('timezone-mock');

const timezones = {
  UTC: 'UTC',
  Australia: 'Australia/Adelaide',
  Brazil: 'Brazil/East',
};

function getTimezoneIdentity(tz) {
  if (tz === timezones.UTC) {
    return 'MockDate: GMT+0000';
  }
  if (tz === timezones.Australia) {
    return ['MockDate: GMT+1030', 'MockDate: GMT+0930'];
  }
  if (tz === timezones.Brazil) {
    return ['MockDate: GMT-0200', 'MockDate: GMT-0300'];
  }

  return 'time_zone_identity_not_found';
}

const tests = timezone =>
  describe('timezone is set to ' + timezone, () => {
    beforeAll(() => {
      // eslint-disable-next-line no-undef
      timezone_mock.register(timezone);
    });

    afterAll(() => {
      // eslint-disable-next-line no-undef
      timezone_mock.unregister();
    });

    it('timezone change works', () => {
      const tzId = getTimezoneIdentity(timezone);
      if (Array.isArray(tzId)) {
        expect(
          tzId.find(id => new Date().toString().includes(id)),
        ).toBeTruthy();
      } else {
        expect(new Date().toString()).toContain(tzId);
      }
    });

    describe('getPrayerTimes()', () => {
      beforeAll(() => {
        calcSettings.setState({
          LOCATION_LAT: 1,
          LOCATION_LONG: 1,
          CALCULATION_METHOD_KEY: 'MoonsightingCommittee', // doesn't matter which for test
        });
      });
      afterAll(() => {
        calcSettings.setState({
          LOCATION_LAT: undefined,
          LOCATION_LONG: undefined,
          CALCULATION_METHOD_KEY: undefined,
        });
      });
      it('returns the same prayer for any time inside the same date', () => {
        // we dont include the timezone deliberately, to use the timezone defined in the beginning of test
        const date1 = new Date('2022-12-27 00:00:00');
        const date2 = new Date('2022-12-27 00:01:00');
        const date3 = new Date('2022-12-27 12:00:00');
        const date4 = new Date('2022-12-27 23:59:59');
        const pt1 = getPrayerTimes(date1);
        const pt2 = getPrayerTimes(date2);
        const pt3 = getPrayerTimes(date3);
        const pt4 = getPrayerTimes(date4);
        delete pt1.date; // as we don't care about the dates comparison
        delete pt2.date;
        delete pt3.date;
        delete pt4.date;
        expect(pt1).toStrictEqual(pt2);
        expect(pt1).toStrictEqual(pt3);
        expect(pt1).toStrictEqual(pt4);

        const date5 = new Date('2022-12-28 00:00:00');
        const pt5 = getPrayerTimes(date5);
        delete pt5.date;
        expect(pt5).not.toStrictEqual(pt1);
      });
    });
  });

describe('prayer times works properly over different timezones', () => {
  for (const tz in timezones) {
    tests(timezones[tz]);
  }
});

describe('prayer times minimum settings check works as expected', () => {
  it('returns false if minimum settings is missing', () => {
    expect(isMinimumSettingsAvailable({})).toBeFalsy();
    expect(isMinimumSettingsAvailable()).toBeFalsy();
  });

  it('returns true when minimum settings is passed to it', () => {
    /** 0 0 lat long coordinates is very unlikely to happen,
     *  so no need to handle it, its in the middle of the ocean ;) */
    expect(
      isMinimumSettingsAvailable({
        LOCATION_LAT: 1,
        LOCATION_LONG: 1,
        CALCULATION_METHOD_KEY: 'something',
      }),
    ).toBeTruthy();
  });

  it('returns false when minimum settings coordinates is not a number', () => {
    expect(
      isMinimumSettingsAvailable({
        LOCATION_LAT: 'foo',
        LOCATION_LONG: 'bar',
        CALCULATION_METHOD_KEY: 'something',
      }),
    ).toBeFalsy();
  });
});

describe('PrayerTimesHelper.nextPrayer()', () => {
  beforeAll(() => {
    calcSettings.setState({
      LOCATION_LAT: 1,
      LOCATION_LONG: 1,
      CALCULATION_METHOD_KEY: 'MoonsightingCommittee', // doesn't matter which for test
    });
  });
  afterAll(() => {
    calcSettings.setState({
      LOCATION_LAT: undefined,
      LOCATION_LONG: undefined,
      CALCULATION_METHOD_KEY: undefined,
    });
  });

  describe('when {useSettings: true} option is used', () => {
    function resetNotificationSoundSettings() {
      const patch = {};
      for (const prayer of PrayersInOrder) {
        patch[getAdhanSettingKey(prayer, 'sound')] = undefined;
        patch[getAdhanSettingKey(prayer, 'notify')] = undefined;
      }
      alarmSettings.setState(patch);
    }
    // we always clear settings before and after each test here
    beforeEach(() => {
      resetNotificationSoundSettings();
    });
    afterEach(() => {
      resetNotificationSoundSettings();
    });

    it('returns undefined when notification/sound settings is empty', () => {
      expect(
        getPrayerTimes(new Date('2022-12-27T00:00:00.000Z')).nextPrayer({
          useSettings: true,
        }),
      ).toBeUndefined();
    });

    describe('With given notification/sound settings', () => {
      beforeEach(() => {
        resetNotificationSoundSettings();
      });
      afterEach(() => {
        resetNotificationSoundSettings();
      });

      it("returns the correct prayer (don't check next days)", () => {
        alarmSettings.setState({FAJR_NOTIFY: true});

        expect(
          getPrayerTimes(new Date('2022-12-27T00:00:00.000Z')).nextPrayer({
            useSettings: true,
          }),
        ).toEqual({
          date: new Date('2022-12-27T04:40:00.000Z'),
          playSound: false,
          prayer: 'fajr',
        });

        alarmSettings.setState({FAJR_SOUND: true});
        expect(
          getPrayerTimes(new Date('2022-12-27T00:00:00.000Z')).nextPrayer({
            useSettings: true,
          }),
        ).toEqual({
          date: new Date('2022-12-27T04:40:00.000Z'),
          playSound: true,
          prayer: 'fajr',
        });

        // test with advancing clock after the set prayer
        // this should yield undefined
        expect(
          getPrayerTimes(
            new Date(new Date('2022-12-27T04:40:00.000Z').valueOf() + 1000),
          ).nextPrayer({
            useSettings: true,
          }),
        ).toBe(undefined);

        // test with a gap and enabling dhuhr
        alarmSettings.setState({DHUHR_NOTIFY: true});
        expect(
          getPrayerTimes(
            new Date(new Date('2022-12-27T04:40:00.000Z').valueOf() + 1000),
          ).nextPrayer({
            useSettings: true,
          }),
        ).toEqual({
          date: new Date('2022-12-27T12:02:00.000Z'),
          playSound: false,
          prayer: 'dhuhr',
        });

        // test with last time (usually goes over to next day)
        alarmSettings.setState({TAHAJJUD_NOTIFY: true, TAHAJJUD_SOUND: true});
        expect(
          getPrayerTimes(
            new Date(new Date('2022-12-27T12:02:00.000Z').valueOf() + 1000),
          ).nextPrayer({
            useSettings: true,
          }),
        ).toEqual({
          date: new Date('2022-12-28T01:08:00.000Z'),
          playSound: true,
          prayer: 'tahajjud',
        });
      });

      it('returns the next available prayer (check next days)', () => {
        alarmSettings.setState({FAJR_NOTIFY: true});

        expect(
          getPrayerTimes(new Date('2022-12-27T00:00:00.000Z')).nextPrayer({
            useSettings: true,
          }),
        ).toEqual({
          date: new Date('2022-12-27T04:40:00.000Z'),
          playSound: false,
          prayer: 'fajr',
        });

        // test with advancing clock after the set prayer
        // this should yield tomorrow's fajr
        expect(
          getPrayerTimes(
            new Date(new Date('2022-12-27T04:40:00.000Z').valueOf() + 1000),
          ).nextPrayer({
            useSettings: true,
            checkNextDay: true,
          }),
        ).toEqual({
          date: new Date('2022-12-28T04:41:00.000Z'),
          playSound: false,
          prayer: 'fajr',
        });

        // repeat with checkNextDays
        expect(
          getPrayerTimes(
            new Date(new Date('2022-12-27T04:40:00.000Z').valueOf() + 1000),
          ).nextPrayer({
            useSettings: true,
            checkNextDays: true,
          }),
        ).toEqual({
          date: new Date('2022-12-28T04:41:00.000Z'),
          playSound: false,
          prayer: 'fajr',
        });
      });

      it('skips days that are disabled (check next days)', () => {
        alarmSettings.setState({FAJR_NOTIFY: {0: true}});
        const testDate = new Date('2022-12-25T09:00:00.000Z'); // near the end of the day, so fajr is behind us, but dhuhr in front
        expect(testDate.getDay()).toBe(0);

        {
          const nextPrayer = getPrayerTimes(testDate).nextPrayer({
            useSettings: true,
            checkNextDays: true,
          });
          expect(nextPrayer).toBeTruthy();
          expect(nextPrayer.playSound).toBeFalsy();
          expect(nextPrayer.prayer).toEqual(Prayer.Fajr);
          // next prayer should be on the same day as settings
          expect(nextPrayer.date.getDay()).toEqual(0);
          // it should be at least 6 days away
          expect(
            nextPrayer.date.valueOf() - testDate.valueOf(),
          ).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
        }

        alarmSettings.setState({
          FAJR_NOTIFY: {0: true},
          DHUHR_NOTIFY: {0: true},
        });
        {
          const nextPrayer = getPrayerTimes(testDate).nextPrayer({
            useSettings: true,
            checkNextDays: true,
          });
          expect(nextPrayer).toBeTruthy();
          expect(nextPrayer.playSound).toBeFalsy();
          expect(nextPrayer.prayer).toEqual(Prayer.Dhuhr);
          expect(nextPrayer.date.getDay()).toEqual(0);
          expect(nextPrayer.date.valueOf() - testDate.valueOf()).toBeLessThan(
            10 * 60 * 60 * 1000, // within 10 hours of fajr
          );
        }

        alarmSettings.setState({
          FAJR_NOTIFY: {0: true},
          DHUHR_NOTIFY: {1: true},
        });

        {
          const nextPrayer = getPrayerTimes(testDate).nextPrayer({
            useSettings: true,
            checkNextDays: true,
          });
          expect(nextPrayer).toBeTruthy();
          expect(nextPrayer.playSound).toBeFalsy();
          expect(nextPrayer.prayer).toEqual(Prayer.Dhuhr);
          expect(nextPrayer.date.getDay()).toEqual(1);
          expect(nextPrayer.date.valueOf() - testDate.valueOf()).toBeLessThan(
            2 * 24 * 60 * 60 * 1000, // within 48 hours
          );
        }

        // REPEAT previous with sound true for dhuhr
        alarmSettings.setState({
          FAJR_NOTIFY: {0: true},
          DHUHR_NOTIFY: {1: true},
          DHUHR_SOUND: true,
        });

        {
          const nextPrayer = getPrayerTimes(testDate).nextPrayer({
            useSettings: true,
            checkNextDays: true,
          });
          expect(nextPrayer).toBeTruthy();
          expect(nextPrayer.playSound).toBeTruthy();
          expect(nextPrayer.prayer).toEqual(Prayer.Dhuhr);
          expect(nextPrayer.date.getDay()).toEqual(1);
          expect(nextPrayer.date.valueOf() - testDate.valueOf()).toBeLessThan(
            2 * 24 * 60 * 60 * 1000, // within 48 hours
          );
        }

        // REPEAT previous with sound partially true (only for monday)
        alarmSettings.setState({
          FAJR_NOTIFY: {0: true},
          DHUHR_NOTIFY: {0: true, 2: true},
          DHUHR_SOUND: {0: true},
        });

        {
          const nextPrayer = getPrayerTimes(testDate).nextPrayer({
            useSettings: true,
            checkNextDays: true,
          });
          expect(nextPrayer).toBeTruthy();
          expect(nextPrayer.playSound).toBeTruthy();
          expect(nextPrayer.prayer).toEqual(Prayer.Dhuhr);
          expect(nextPrayer.date.getDay()).toEqual(0);
        }

        {
          // testing notify and no partial sound (monday)
          const nextPrayer = getPrayerTimes(addDays(testDate, 1)).nextPrayer({
            useSettings: true,
            checkNextDays: true,
          });
          expect(nextPrayer).toBeTruthy();
          expect(nextPrayer.date.getDay()).toEqual(2);
          expect(nextPrayer.playSound).toBeFalsy();
          expect(nextPrayer.prayer).toEqual(Prayer.Dhuhr);
        }
      });
    });
  });
});
