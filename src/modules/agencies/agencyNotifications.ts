import { env } from "../../config/env";
import {
  sendAgencyApplicationReceivedEmail,
  sendAgencyApprovedEmail,
  sendAgencyRejectedEmail,
  sendNewAgencyApplicationEmail
} from "../../services/email";
import type { AgencyRepository, AgencyWithOwner } from "./agencyTypes";

/**
 * Emails people about agency registration (capstone panel item 20).
 * Every method resolves: a failed lookup or send is logged, never thrown,
 * so it can't fail or undo the decision it reports.
 */
export type AgencyNotifier = {
  applicationSubmitted(agencyId: string): Promise<void>;
  agencyApproved(agencyId: string): Promise<void>;
  agencyRejected(agencyId: string): Promise<void>;
};

export const noopAgencyNotifier: AgencyNotifier = {
  async applicationSubmitted() {},
  async agencyApproved() {},
  async agencyRejected() {}
};

export type AgencyEmailSender = {
  sendAgencyApplicationReceivedEmail: typeof sendAgencyApplicationReceivedEmail;
  sendAgencyApprovedEmail: typeof sendAgencyApprovedEmail;
  sendAgencyRejectedEmail: typeof sendAgencyRejectedEmail;
  sendNewAgencyApplicationEmail: typeof sendNewAgencyApplicationEmail;
};

const defaultEmailSender: AgencyEmailSender = {
  sendAgencyApplicationReceivedEmail,
  sendAgencyApprovedEmail,
  sendAgencyRejectedEmail,
  sendNewAgencyApplicationEmail
};

type LogError = (message: string, details: Record<string, unknown>) => void;

export function createAgencyNotifier(options: {
  repository: Pick<AgencyRepository, "findAgencyByIdWithOwner" | "listActiveSuperAdmins">;
  emailSender?: AgencyEmailSender;
  appOrigin?: string;
  logError?: LogError;
}): AgencyNotifier {
  const emailSender = options.emailSender ?? defaultEmailSender;
  const origin = (options.appOrigin ?? env.APP_ORIGIN).replace(/\/+$/, "");
  const logError: LogError = options.logError ?? ((message, details) => console.error(message, details));
  // `/?authenticated=1` opens the signed-in app: the status screen while pending, the workspace once approved.
  const appUrl = `${origin}/?authenticated=1`;
  const adminUrl = `${origin}/?authenticated=1&tab=admin`;

  async function attempt<T>(step: string, agencyId: string, work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      logError(`[agencyNotifications] ${step} failed`, { agencyId, error });
      return null;
    }
  }

  function loadAgency(agencyId: string): Promise<AgencyWithOwner | null> {
    return attempt("agency lookup", agencyId, () => options.repository.findAgencyByIdWithOwner(agencyId));
  }

  return {
    async applicationSubmitted(agencyId) {
      const agency = await loadAgency(agencyId);
      if (!agency) return;

      await attempt("application received email", agencyId, () =>
        emailSender.sendAgencyApplicationReceivedEmail({
          to: agency.ownerUser.email,
          displayName: agency.ownerUser.displayName,
          agencyName: agency.name,
          statusUrl: appUrl
        })
      );

      const admins = (await attempt("super admin lookup", agencyId, () => options.repository.listActiveSuperAdmins())) ?? [];
      const location =
        [agency.city, agency.country]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(", ") || null;
      // One at a time to stay under Resend's ~2 req/s limit (there is no retry).
      for (const admin of admins) {
        await attempt("new application alert", agencyId, () =>
          emailSender.sendNewAgencyApplicationEmail({
            to: admin.email,
            agencyName: agency.name,
            ownerName: agency.ownerUser.displayName,
            ownerEmail: agency.ownerUser.email,
            location,
            reviewUrl: adminUrl
          })
        );
      }
    },

    async agencyApproved(agencyId) {
      const agency = await loadAgency(agencyId);
      if (!agency) return;
      await attempt("approval email", agencyId, () =>
        emailSender.sendAgencyApprovedEmail({
          to: agency.ownerUser.email,
          displayName: agency.ownerUser.displayName,
          agencyName: agency.name,
          workspaceUrl: appUrl
        })
      );
    },

    async agencyRejected(agencyId) {
      const agency = await loadAgency(agencyId);
      if (!agency) return;
      await attempt("rejection email", agencyId, () =>
        emailSender.sendAgencyRejectedEmail({
          to: agency.ownerUser.email,
          displayName: agency.ownerUser.displayName,
          agencyName: agency.name,
          reason: agency.rejectionReason ?? "",
          statusUrl: appUrl
        })
      );
    }
  };
}
