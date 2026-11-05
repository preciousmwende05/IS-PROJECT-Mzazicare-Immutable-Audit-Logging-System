
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors";
import { recordAuditEvent } from "@/shared/middleware/audit.middleware";
import { isCarePlanSharedWithCaregivers } from "@/modules/elder-service/services/consent.hook";
import type {
  AuthUser,
} from "@/shared/types";
import { Types } from "mongoose";
import type {
  CarePlan,
  CareCircleMember,
  EmergencyContact,
} from "../models/elder.model";
import type {
  UpdateCarePlanInput,
  AddEmergencyContactInput,
  InviteCareCircleMemberInput,
  UpdateCareCircleMemberInput,
  CarePlanHistoryQuery,
} from "../validation/elder.validation";

type CareDataRepository = {
  findById(id: string): Promise<unknown | null>;
  findCircleMember(
    elderId: string,
    userId: string,
  ): Promise<CareCircleMember | null>;
  findCircleMemberByUser(
    elderId: string,
    userId: string,
  ): Promise<CareCircleMember | null>;
  findCurrentCarePlan(elderId: string): Promise<CarePlan | null>;
  findCarePlanHistory(
    elderId: string,
    skip: number,
    limit: number,
  ): Promise<[CarePlan[], number]>;
  findLatestCarePlanVersion(elderId: string): Promise<number>;
  createCarePlanVersion(
    data: Omit<CarePlan, "_id" | "createdAt" | "updatedAt">,
  ): Promise<CarePlan>;
  findEmergencyContacts(
    elderId: string,
  ): Promise<EmergencyContact[]>;
  createEmergencyContact(
    data: Omit<
      EmergencyContact,
      "_id" | "createdAt" | "updatedAt"
    >,
  ): Promise<EmergencyContact>;
  findCircleMembers(
    elderId: string,
  ): Promise<CareCircleMember[]>;
  addCircleMember(
    data: Omit<
      CareCircleMember,
      "_id" | "createdAt" | "updatedAt"
    >,
  ): Promise<CareCircleMember>;
  updateCircleMemberAccess(
    elderId: string,
    userId: string,
    accessLevel: "editor" | "viewer",
  ): Promise<CareCircleMember | null>;
  acceptCircleMember(
    elderId: string,
    userId: string,
  ): Promise<CareCircleMember | null>;
  removeCircleMember(
    elderId: string,
    userId: string,
  ): Promise<unknown>;
  countAcceptedOwners(elderId: string): Promise<number>;
};

const isStaff = (user: AuthUser) =>
  user.role === "admin" || user.role === "coordinator";

export class ElderCareDataService {
  constructor(private readonly repository: CareDataRepository) {}

  private async getElderOr404(elderId: string) {
    const elder = await this.repository.findById(elderId);
    if (!elder) throw new NotFoundError("Elder");
    return elder;
  }

  private async requireCircleAccess(
    elderId: string,
    user: AuthUser,
  ) {
    await this.getElderOr404(elderId);

    if (isStaff(user)) return null;

    const member = await this.repository.findCircleMember(
      elderId,
      user.id,
    );

    // Return 404 for non-members to avoid disclosing elder records, but record
    // the refusal: it is the snooping signal (care plans are the most
    // sensitive data we hold).
    if (!member) {
      recordAuditEvent({
        action: "access.denied",
        actorId: user.id,
        actorRole: user.role,
        outcome: "failure",
        statusCode: 404,
        subject: { elderId, reason: "not in care circle (care data)" },
      });
      throw new NotFoundError("Elder");
    }
    return member;
  }

  private async requireEditor(
    elderId: string,
    user: AuthUser,
  ) {
    const member = await this.requireCircleAccess(elderId, user);

    if (
      !isStaff(user) &&
      member?.accessLevel !== "owner" &&
      member?.accessLevel !== "editor"
    ) {
      throw new ForbiddenError("Editor access is required");
    }

    return member;
  }

  private async requireOwner(
    elderId: string,
    user: AuthUser,
  ) {
    const member = await this.requireCircleAccess(elderId, user);

    if (!isStaff(user) && member?.accessLevel !== "owner") {
      throw new ForbiddenError("Owner access is required");
    }

    return member;
  }

  async getCarePlan(elderId: string, user: AuthUser) {
    await this.requireCircleAccess(elderId, user);
    // Consent (Kenya DPA): a caregiver sees the care plan only while the elder
    // or their guardian agrees to share it. The 403 is recorded as access.denied.
    if (user.role === "caregiver" && !(await isCarePlanSharedWithCaregivers(elderId))) {
      throw new ForbiddenError("The family has not given consent to share this care plan with caregivers");
    }
    return this.repository.findCurrentCarePlan(elderId);
  }

  async updateCarePlan(
    elderId: string,
    input: UpdateCarePlanInput,
    user: AuthUser,
  ) {
    await this.requireEditor(elderId, user);

    const current = await this.repository.findCurrentCarePlan(elderId);
    const version =
      (await this.repository.findLatestCarePlanVersion(elderId)) + 1;

    // A new document is created for every update. Previous versions remain
    // available as history and are never overwritten.
    const data: Parameters<
      CareDataRepository["createCarePlanVersion"]
    >[0] = {
      elderId: new Types.ObjectId(elderId),
      version,
      conditions: input.conditions ?? current?.conditions ?? [],
      medications: input.medications ?? current?.medications ?? [],
      allergies: input.allergies ?? current?.allergies ?? [],
      mobility: input.mobility ?? current?.mobility ?? "independent",
      dietary: input.dietary ?? current?.dietary ?? [],
      careNotes: input.careNotes ?? current?.careNotes ?? "",
      updatedBy: new Types.ObjectId(user.id),
    } as Parameters<
      CareDataRepository["createCarePlanVersion"]
    >[0];

    const carePlan =
      await this.repository.createCarePlanVersion(data);

    return carePlan;
  }

  async getCarePlanHistory(
    elderId: string,
    query: CarePlanHistoryQuery,
    user: AuthUser,
  ) {
    await this.requireEditor(elderId, user);

    const skip = (query.page - 1) * query.limit;
    const [items, total] =
      await this.repository.findCarePlanHistory(
        elderId,
        skip,
        query.limit,
      );

    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async listEmergencyContacts(
    elderId: string,
    user: AuthUser,
  ) {
    await this.requireCircleAccess(elderId, user);
    return this.repository.findEmergencyContacts(elderId);
  }

  async addEmergencyContact(
    elderId: string,
    input: AddEmergencyContactInput,
    user: AuthUser,
  ) {
    await this.requireEditor(elderId, user);

    return this.repository.createEmergencyContact({
      elderId: new Types.ObjectId(elderId),
      name: input.name,
      phone: input.phone,
      relationship: input.relationship,
      priority: input.priority,
    });
  }

  async listCareCircle(
    elderId: string,
    user: AuthUser,
  ) {
    await this.requireCircleAccess(elderId, user);
    return this.repository.findCircleMembers(elderId);
  }

  async inviteCareCircleMember(
    elderId: string,
    input: InviteCareCircleMemberInput,
    user: AuthUser,
  ) {
    await this.requireOwner(elderId, user);

    if (input.userId === user.id) {
      throw new ConflictError("You are already in this care circle");
    }

    const existing = await this.repository.findCircleMemberByUser(
      elderId,
      input.userId,
    );

    if (existing) {
      throw new ConflictError(
        "This user already has a care-circle entry",
      );
    }

    return this.repository.addCircleMember({
      elderId: new Types.ObjectId(elderId),
      userId: new Types.ObjectId(input.userId),
      relationship: input.relationship,
      accessLevel: input.accessLevel,
      invitedBy: new Types.ObjectId(user.id),
      acceptedAt: null,
    });
  }

  /**
   * The invited user accepts their own pending invitation. Until then the
   * membership grants no access. Anyone without a pending invitation gets a
   * 404, so this cannot be used to probe which elders exist.
   */
  async acceptCareCircleInvitation(
    elderId: string,
    user: AuthUser,
  ) {
    const member = await this.repository.acceptCircleMember(
      elderId,
      user.id,
    );

    if (!member) throw new NotFoundError("Invitation");
    return member;
  }

  async updateCareCircleMember(
    elderId: string,
    targetUserId: string,
    input: UpdateCareCircleMemberInput,
    user: AuthUser,
  ) {
    await this.requireOwner(elderId, user);

    const target = await this.repository.findCircleMemberByUser(
      elderId,
      targetUserId,
    );

    if (!target) {
      throw new NotFoundError("Care-circle member");
    }

    if (target.accessLevel === "owner") {
      throw new ForbiddenError(
        "Owner access cannot be changed through this operation",
      );
    }

    return this.repository.updateCircleMemberAccess(
      elderId,
      targetUserId,
      input.accessLevel,
    );
  }

  async removeCareCircleMember(
    elderId: string,
    targetUserId: string,
    user: AuthUser,
  ) {
    await this.requireOwner(elderId, user);

    const target = await this.repository.findCircleMemberByUser(
      elderId,
      targetUserId,
    );

    if (!target) {
      throw new NotFoundError("Care-circle member");
    }

    if (target.accessLevel === "owner" && target.acceptedAt) {
      const ownerCount =
        await this.repository.countAcceptedOwners(elderId);

      if (ownerCount <= 1) {
        throw new ConflictError(
          "The last accepted owner cannot be removed",
        );
      }
    }

    await this.repository.removeCircleMember(
      elderId,
      targetUserId,
    );
  }
}
