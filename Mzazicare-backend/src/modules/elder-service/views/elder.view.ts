/**
 * U-CS 68 — Digital Elder Profile & Care Data System
 * Owner(s): Ian Omwenga, Mepani Bhavin Ramesh
 */

import type {
  CareCircleMember,
  CarePlan,
  Elder,
  EmergencyContact,
} from "@/modules/elder-service/models/elder.model";

/**
 * The shape the API returns.
 *
 * Views exist so that MongoDB documents can never leak a field by accident.
 * A field must be deliberately included here before the API exposes it.
 */

export type ElderView = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  age: number;
  gender: Elder["gender"];

  homeLocation: {
    latitude: number;
    longitude: number;
  };

  address: {
    estate: string | null;
    street: string | null;
    landmark: string | null;
    county: string | null;
  };

  primaryContactUserId: string;
  status: Elder["status"];

  createdAt: string;
  updatedAt: string;
};

/**
 * Whole years.
 *
 * A birthday later this year has not counted yet.
 */
const ageOn = (
  dateOfBirth: Date,
  now = new Date(),
): number => {
  const years =
    now.getUTCFullYear() -
    dateOfBirth.getUTCFullYear();

  const birthdayPending =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (
      now.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      now.getUTCDate() < dateOfBirth.getUTCDate()
    );

  return birthdayPending ? years - 1 : years;
};

/**
 * MongoDB stores GeoJSON as:
 *
 * [longitude, latitude]
 *
 * The API exposes named values so clients cannot accidentally interpret the
 * array in the wrong order.
 */
const coordinatesOf = (
  point: Elder["homeLocation"],
) => ({
  latitude: point?.coordinates?.[1] ?? 0,
  longitude: point?.coordinates?.[0] ?? 0,
});

const addressOf = (
  address: Elder["address"],
) => ({
  estate: address?.estate ?? null,
  street: address?.street ?? null,
  landmark: address?.landmark ?? null,
  county: address?.county ?? null,
});

/**
 * photoKey is deliberately absent.
 *
 * A raw storage key/path must never reach the client.
 */
export const serializeElder = (
  elder: Elder,
): ElderView => ({
  id: String(elder._id),

  firstName: elder.firstName,
  lastName: elder.lastName,

  dateOfBirth: elder.dateOfBirth.toISOString(),
  age: ageOn(elder.dateOfBirth),

  gender: elder.gender,

  homeLocation: coordinatesOf(
    elder.homeLocation,
  ),

  address: addressOf(
    elder.address,
  ),

  primaryContactUserId:
    String(elder.primaryContactUserId),

  status: elder.status,

  createdAt:
    elder.createdAt.toISOString(),

  updatedAt:
    elder.updatedAt.toISOString(),
});

/**
 * Care plan
 */

export type CarePlanView = {
  id: string;
  elderId: string;
  version: number;

  conditions: string[];

  medications: {
    name: string;
    dosage: string | null;
    schedule: string | null;
    prescribedBy: string | null;
  }[];

  allergies: string[];
  mobility: CarePlan["mobility"];
  dietary: string[];
  careNotes: string;

  updatedBy: string;

  createdAt: string;
  updatedAt: string;
};

export const serializeCarePlan = (
  carePlan: CarePlan,
): CarePlanView => ({
  id: String(carePlan._id),

  elderId: String(carePlan.elderId),

  version: carePlan.version,

  conditions: [
    ...carePlan.conditions,
  ],

  medications: (
    carePlan.medications ?? []
  ).map((medication) => ({
    name: medication.name,
    dosage: medication.dosage ?? null,
    schedule: medication.schedule ?? null,
    prescribedBy:
      medication.prescribedBy ?? null,
  })),

  allergies: [
    ...carePlan.allergies,
  ],

  mobility: carePlan.mobility,

  dietary: [
    ...carePlan.dietary,
  ],

  careNotes: carePlan.careNotes ?? "",

  updatedBy: String(carePlan.updatedBy),

  createdAt:
    carePlan.createdAt.toISOString(),

  updatedAt:
    carePlan.updatedAt.toISOString(),
});

/**
 * Care circle
 */

export type CareCircleMemberView = {
  id: string;
  elderId: string;
  userId: string;
  relationship: string | null;
  accessLevel: CareCircleMember["accessLevel"];
  invitedBy: string;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const serializeCareCircleMember = (
  member: CareCircleMember,
): CareCircleMemberView => ({
  id: String(member._id),

  elderId: String(member.elderId),

  userId: String(member.userId),

  relationship:
    member.relationship ?? null,

  accessLevel:
    member.accessLevel,

  invitedBy:
    String(member.invitedBy),

  acceptedAt:
    member.acceptedAt
      ? member.acceptedAt.toISOString()
      : null,

  createdAt:
    member.createdAt.toISOString(),

  updatedAt:
    member.updatedAt.toISOString(),
});

/**
 * Emergency contacts

 */

export type EmergencyContactView = {
  id: string;
  elderId: string;
  name: string;
  phone: string;
  relationship: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export const serializeEmergencyContact = (
  contact: EmergencyContact,
): EmergencyContactView => ({
  id: String(contact._id),

  elderId: String(contact.elderId),

  name: contact.name,

  phone: contact.phone,

  relationship:
    contact.relationship ?? null,

  priority: contact.priority,

  createdAt:
    contact.createdAt.toISOString(),

  updatedAt:
    contact.updatedAt.toISOString(),
});

/**
 * Caregiver brief
 *
 * This is intentionally NOT ElderView with fields removed.
 *
 * A caregiver gets a distinct response shape containing only the information
 * needed for an active booking.
 */

export type CaregiverBriefView = {
  elderId: string;
  name: string;
  age: number;

  address: ElderView["address"];

  homeLocation:
    ElderView["homeLocation"];

  mobility:
    CarePlan["mobility"] | null;

  conditions: string[];

  allergies: string[];

  medications: {
    name: string;
    dosage: string | null;
    schedule: string | null;
    prescribedBy: string | null;
  }[];

  dietary: string[];

  careNotes: string | null;

  emergencyContacts: {
    name: string;
    phone: string;
    relationship: string | null;
    priority: number;
  }[];
};

export const serializeCaregiverBrief = (
  elder: Elder,
  carePlan: CarePlan | null,
  contacts: EmergencyContact[],
): CaregiverBriefView => ({
  elderId: String(elder._id),

  name:
    `${elder.firstName} ${elder.lastName}`,

  age:
    ageOn(elder.dateOfBirth),

  address:
    addressOf(elder.address),

  homeLocation:
    coordinatesOf(elder.homeLocation),

  mobility:
    carePlan?.mobility ?? null,

  conditions:
    carePlan?.conditions ?? [],

  allergies:
    carePlan?.allergies ?? [],

  medications:
    (carePlan?.medications ?? []).map(
      (medication) => ({
        name: medication.name,
        dosage:
          medication.dosage ?? null,
        schedule:
          medication.schedule ?? null,
        prescribedBy:
          medication.prescribedBy ?? null,
      }),
    ),

  dietary:
    carePlan?.dietary ?? [],

  careNotes:
    carePlan?.careNotes ?? null,

  emergencyContacts:
    contacts.map((contact) => ({
      name: contact.name,
      phone: contact.phone,
      relationship:
        contact.relationship ?? null,
      priority: contact.priority,
    })),
});