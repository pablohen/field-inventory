import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useHandheld } from '#/handheld/context';
import { getCachedReplicaConfig } from '#/handheld/session-store';

export const Route = createFileRoute('/h/')({ component: HandheldHome });

function Exceptions({ wh }: { wh: string }) {
  const { backend } = useHandheld();
  const { data } = useQuery({
    queryKey: ['h', wh, 'exceptions'],
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call('myOpenExceptions', wh),
    enabled: backend !== null,
  });
  if (!data || data.length === 0) return null;
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        Open exceptions
      </Text>
      {data.map((e) => (
        <Group key={e.id} gap="xs">
          <Badge color="orange">{e.type}</Badge>
          <Text size="sm">{e.skuId ?? e.locationId ?? e.id}</Text>
        </Group>
      ))}
    </Stack>
  );
}

function HandheldHome() {
  const { session } = useHandheld();
  // Re-read on every render: the leader writes the config after its first fetch.
  const warehouses = (getCachedReplicaConfig()?.replicas ?? [])
    .map((r) => r.name)
    .filter((n) => n !== 'catalog');

  return (
    <Stack>
      {session && <Text>Signed in as {session.name}</Text>}
      <Title order={4}>Warehouses</Title>
      {warehouses.length === 0 && (
        <Text c="dimmed">
          No warehouses yet. Connect once to download them.
        </Text>
      )}
      {warehouses.map((wh) => (
        <Card key={wh} withBorder>
          <Stack gap="xs">
            <Text fw={600}>{wh}</Text>
            <Group gap="xs">
              <Button
                renderRoot={(props) => (
                  <Link to="/h/$wh/stock" params={{ wh }} {...props} />
                )}
                size="compact-md"
              >
                Stock
              </Button>
              {(
                [
                  ['count', 'Count'],
                  ['move', 'Move'],
                  ['transfer-in', 'Transfer in'],
                  ['pick', 'Pick'],
                  ['adjust', 'Adjust'],
                ] as const
              ).map(([slug, label]) => (
                // TODO(T11): Link
                <Button
                  key={slug}
                  component="a"
                  href={`/h/${encodeURIComponent(wh)}/${slug}`}
                  size="compact-md"
                  variant="light"
                >
                  {label}
                </Button>
              ))}
            </Group>
            <Exceptions wh={wh} />
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
