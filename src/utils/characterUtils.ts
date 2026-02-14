export const normalizeCharacterRole = (value: string): string => {
  return value.trim();
};

/** Capitalize the first letter of a string. */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compute the interval between two ISO date strings. Returns null if inputs are invalid. */
export function computeInterval(fromDate: string, toDate: string, unit: string): number | null {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;

  switch (unit) {
    case 'years': {
      let years = to.getFullYear() - from.getFullYear();
      if (to.getMonth() < from.getMonth() ||
          (to.getMonth() === from.getMonth() && to.getDate() < from.getDate())) {
        years--;
      }
      return years;
    }
    case 'months': {
      let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
      if (to.getDate() < from.getDate()) months--;
      return months;
    }
    case 'days': {
      const msPerDay = 86400000;
      return Math.floor((to.getTime() - from.getTime()) / msPerDay);
    }
    default:
      return null;
  }
}
