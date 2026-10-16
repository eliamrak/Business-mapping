import { generateKeyPairSync, randomUUID, sign } from "node:crypto";

// Trust exists only in the disposable API process receiving this fresh public key.
export function syntheticClerkFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    env: {
      CLERK_JWT_KEY: publicKey.export({ type: "spki", format: "pem" }),
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("clerk.synthetic.invalid$").toString("base64")}`,
      CLERK_SECRET_KEY: "sk_test_isolated_noncredential",
      CLERK_TELEMETRY_DISABLED: "true",
      // Unexpected remote-user lookups cannot use Clerk's real service.
      CLERK_API_URL: "http://127.0.0.1:1",
    },
    token(email, claims = {}) {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "synthetic-local-only" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({
        v: 2,
        sub: `user_${randomUUID().replaceAll("-", "")}`,
        sid: `sess_${randomUUID().replaceAll("-", "")}`,
        sts: "active",
        iss: "https://clerk.synthetic.invalid",
        iat: now,
        nbf: now - 5,
        exp: now + 600,
        email,
        ...claims,
      })).toString("base64url");
      const input = `${header}.${payload}`;
      return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
    },
  };
}
