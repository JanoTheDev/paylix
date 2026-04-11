import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { join } from "node:path";
import { db } from "./db";
import * as schema from "@paylix/db/schema";
import { sendMail, renderTemplate } from "@paylix/mailer";

const MAILER_TEMPLATE_ROOT = join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "mailer",
  "src",
  "templates",
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
        const html = renderTemplate(
          join(MAILER_TEMPLATE_ROOT, "invitation.html"),
          vars,
        );
        const text = renderTemplate(
          join(MAILER_TEMPLATE_ROOT, "invitation.txt"),
          vars,
        );
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
