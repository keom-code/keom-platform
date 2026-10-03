import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("Correct horse battery staple", hash)).resolves.toBe(false);
  });

  it("never stores the password and salts every hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toContain("same-password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$whatever")).resolves.toBe(false);
  });
});
