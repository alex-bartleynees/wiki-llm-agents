export const showLineDiff = (before: string, after: string) => before.split("\n").length * after.split("\n").length < 1_000_000;
