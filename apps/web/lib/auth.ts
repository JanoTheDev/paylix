import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { db } from "./db";
import * as schema from "@paylix/db/schema";
import { sendMail, renderString } from "@paylix/mailer";

const MAILER_TEMPLATE_ROOT = join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "mailer",
  "src",
  "templates",
);

const INVITATION_HTML_TEMPLATE = readFileSync(
  join(MAILER_TEMPLATE_ROOT, "invitation.html"),
  "utf8",
);
const INVITATION_TXT_TEMPLATE = readFileSync(
  join(MAILER_TEMPLATE_ROOT, "invitation.txt"),
  "utf8",
);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    // Explicit, not inherited from a framework default: the middleware CSRF
    // check and SameSite are the two layers protecting cookie-authenticated
    // dashboard writes. "lax" keeps top-level GET navigations working while
    // blocking cross-site POSTs from carrying the session.
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
      invitationExpiresIn: 60 * 60 * 24 * 7,
      async sendInvitationEmail({ invitation, organization, inviter }) {
        const baseUrl =
          process.env.BETTER_AUTH_URL || "http://localhost:3000";
        const acceptUrl = `${baseUrl}/invite/${invitation.id}`;
        const vars = {
          teamName: organization.name,
          inviterName: inviter.user.name || inviter.user.email,
          inviterEmail: inviter.user.email,
          acceptUrl,
          expiresAt: new Date(invitation.expiresAt).toLocaleDateString(
            "en-US",
            { year: "numeric", month: "long", day: "numeric" },
          ),
        };
        const html = renderString(INVITATION_HTML_TEMPLATE, vars);
        const text = renderString(INVITATION_TXT_TEMPLATE, vars);
        await sendMail({
          to: invitation.email,
          from: process.env.MAIL_FROM || "Paylix <noreply@paylix.dev>",
          subject: `You've been invited to join ${organization.name} on Paylix`,
          html,
          text,
        });
      },
    }),
  ],
});
