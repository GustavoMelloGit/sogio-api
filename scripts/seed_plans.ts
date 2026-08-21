import { seedPlans } from "../tests/helpers/fixtures/plan";

seedPlans()
  .then(() => {
    console.log("Plans seeded (free, pro)");
    process.exit(0);
  })
  .catch(error => {
    console.error("Failed to seed plans", error);
    process.exit(1);
  });
