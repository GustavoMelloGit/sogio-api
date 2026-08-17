import { seedPlans } from "../src/billing/infra/database/seed_plans";

seedPlans()
  .then(() => {
    console.log("Plans seeded (free, pro)");
    process.exit(0);
  })
  .catch(error => {
    console.error("Failed to seed plans", error);
    process.exit(1);
  });
