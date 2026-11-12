// Publish the starting catalog (types of help) through the API, as an admin.
// Run via seed-catalog.sh. Safe to run twice: existing slugs are skipped.

const BASE = process.env.API_URL;
const PHONE = process.env.ADMIN_PHONE;
const PASSWORD = process.env.ADMIN_PASSWORD;

const call = async (method, path, token, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const login = await call("POST", "/auth/login", null, { phone: PHONE, password: PASSWORD });
const token = login.json?.data?.accessToken;
if (!token || login.json.data.user.role !== "admin") {
  console.error("Sign-in failed or the account is not an admin:", login.json?.error?.message ?? login.status);
  process.exit(1);
}

const categories = [
  { name: "Personal Care", slug: "personal-care", description: "Bathing, dressing, grooming and toileting support.", sortOrder: 1 },
  { name: "Household Support", slug: "household-support", description: "Meals, light cleaning and errands at home.", sortOrder: 2 },
  { name: "Health Support", slug: "health-support", description: "Medication reminders, mobility and nursing care.", sortOrder: 3 },
];

// Prices are integer cents of KES: 50000 = KES 500. Adjust before going live.
const services = [
  ["Personal care", "personal-care", "Help with bathing, dressing, grooming and toileting, with dignity.", 50000, "per_hour", 60, ["personal_care"]],
  ["Meal preparation", "household-support", "Cooking nutritious Kenyan meals (ugali, githeri, uji) and help with feeding.", 40000, "per_hour", 60, ["meal_preparation"]],
  ["Light housekeeping", "household-support", "Tidying, laundry and keeping the home safe and clean.", 35000, "per_hour", 60, ["housekeeping"]],
  ["Mobility support", "health-support", "Safe transfers, walking assistance and gentle exercises.", 50000, "per_hour", 60, ["mobility_support"]],
  ["Medication reminders", "health-support", "Prompting and recording medication as per the care plan.", 60000, "per_visit", 30, ["medication_support"]],
  ["Nursing care", "health-support", "Wound care, vitals and clinical observation by a registered nurse.", 120000, "per_hour", 60, ["nursing"]],
  ["Respite care", "personal-care", "A full day of care so family caregivers can rest.", 350000, "per_day", 480, ["personal_care"]],
];

const catId = {};
for (const c of categories) {
  const r = await call("POST", "/services/categories", token, c);
  catId[c.slug] = r.json?.data?.id ?? (await call("GET", `/services/categories/${c.slug}`, token)).json?.data?.category?.id;
  console.log(`category ${c.name}: ${r.status === 201 ? "created" : "exists"}`);
}

let order = 0;
for (const [name, cat, description, basePriceCents, pricingUnit, minimumDurationMinutes, requiredSkills] of services) {
  order += 1;
  const r = await call("POST", "/services", token, {
    name, categoryId: catId[cat], description, basePriceCents, pricingUnit, minimumDurationMinutes, requiredSkills, sortOrder: order,
  });
  if (r.status === 409) { console.log(`service ${name}: exists`); continue; }
  const id = r.json?.data?.id;
  const p = id ? await call("POST", `/services/${id}/publish`, token) : r;
  console.log(`service ${name}: ${p.status === 200 ? "created and published" : `failed (${r.json?.error?.message ?? r.status})`}`);
}
