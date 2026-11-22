export class SkillProblem extends Error {
  constructor(message: string, readonly status: 404 | 409 | 422 = 422) {
    super(message);
  }
}
