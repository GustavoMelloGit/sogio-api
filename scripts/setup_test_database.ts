import { databaseNameOf, ensureTestDatabase } from "../tests/test_database";

ensureTestDatabase()
  .then(url => {
    console.log(`Test database ready: ${databaseNameOf(url)}`);
    process.exit(0);
  })
  .catch(error => {
    console.error("Failed to prepare the test database", error);
    process.exit(1);
  });
