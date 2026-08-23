import { pruneTestDatabases } from "../tests/test_database";

pruneTestDatabases()
  .then(dropped => {
    if (dropped.length === 0) {
      console.log("No orphan test databases to drop");
    } else {
      console.log(`Dropped ${dropped.length}: ${dropped.join(", ")}`);
    }
    process.exit(0);
  })
  .catch(error => {
    console.error("Failed to prune test databases", error);
    process.exit(1);
  });
