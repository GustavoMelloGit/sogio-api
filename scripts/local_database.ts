import { $ } from "bun";

const CONTAINER_NAME = "sogio_db";
const VOLUME_NAME = "sogio_db_data";
const IMAGE = "postgres:17-alpine";
const HOST_PORT = 5434;
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "mypassword";
const POSTGRES_DB = "sogio";
const VOLUME_MOUNT = "/var/lib/postgresql/data";
const READINESS_TIMEOUT_MS = 30_000;

type ContainerState = "missing" | "running" | "stopped";

type ContainerSummary = {
  configuration: { id: string };
  status: { state?: string };
};

async function ensureSystemRunning() {
  const status = await $`container system status`.nothrow().quiet();
  if (status.exitCode === 0) return;
  await $`container system start --enable-kernel-install`;
}

async function stateOfContainer(): Promise<ContainerState> {
  const containers =
    (await $`container list --all --format json`.json()) as ContainerSummary[];
  const container = containers.find(
    candidate => candidate.configuration.id === CONTAINER_NAME
  );
  if (!container) return "missing";
  return container.status.state === "running" ? "running" : "stopped";
}

async function ensureVolume() {
  const volumes = await $`container volume list --quiet`.text();
  if (volumes.split("\n").includes(VOLUME_NAME)) return;
  await $`container volume create ${VOLUME_NAME}`;
}

async function runContainer() {
  await ensureVolume();
  await $`container run --detach --name ${CONTAINER_NAME} \
    --publish 127.0.0.1:${HOST_PORT}:5432 \
    --env POSTGRES_USER=${POSTGRES_USER} \
    --env POSTGRES_PASSWORD=${POSTGRES_PASSWORD} \
    --env POSTGRES_DB=${POSTGRES_DB} \
    --env PGDATA=${VOLUME_MOUNT}/pgdata \
    --volume ${VOLUME_NAME}:${VOLUME_MOUNT} \
    ${IMAGE}`;
}

async function waitUntilReady() {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe =
      await $`container exec ${CONTAINER_NAME} pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`
        .nothrow()
        .quiet();
    if (probe.exitCode === 0) return;
    await Bun.sleep(500);
  }
  throw new Error(
    `${CONTAINER_NAME} did not accept connections within ${READINESS_TIMEOUT_MS} ms`
  );
}

async function start() {
  await ensureSystemRunning();
  const state = await stateOfContainer();
  if (state === "missing") await runContainer();
  if (state === "stopped") await $`container start ${CONTAINER_NAME}`;
  await waitUntilReady();
  console.log(
    `${CONTAINER_NAME} ready on postgres://${POSTGRES_USER}@localhost:${HOST_PORT}/${POSTGRES_DB}`
  );
}

async function stop() {
  const status = await $`container system status`.nothrow().quiet();
  if (status.exitCode !== 0 || (await stateOfContainer()) !== "running") {
    console.log(`${CONTAINER_NAME} is not running`);
    return;
  }
  await $`container stop ${CONTAINER_NAME}`;
}

const commands: Record<string, () => Promise<void>> = { start, stop };
const command = commands[process.argv[2] ?? ""];

if (!command) {
  console.error("Usage: bun run scripts/local_database.ts <start|stop>");
  process.exit(1);
}

command()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Local database command failed", error);
    process.exit(1);
  });
