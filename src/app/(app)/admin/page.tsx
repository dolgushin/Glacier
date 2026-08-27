import { listInvites, requireAdmin } from "@/lib/auth";
import { listUsers, userFootprint } from "@/lib/accounts";
import { all } from "@/lib/db";
import { Metric, Section } from "@/components/ui";
import { InviteCreator } from "./invite-creator";
import {
  CreateUser,
  InviteTable,
  UserTable,
  type AdminInvite,
  type AdminUser,
} from "./user-manager";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdmin();

  const users: AdminUser[] = listUsers().map((user) => {
    const footprint = userFootprint(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.is_active === 1,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      portfolios: footprint.portfolios,
      transactions: footprint.transactions,
      connections: footprint.connections,
    };
  });

  const invites: AdminInvite[] = listInvites().map((invite) => ({
    code: invite.code,
    note: invite.note,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at,
    usedAt: invite.used_at,
    usedByEmail: invite.used_by_email,
  }));

  const now = new Date().toISOString();
  const pending = invites.filter(
    (invite) => !invite.usedAt && (invite.expiresAt === null || invite.expiresAt >= now),
  );
  const admins = users.filter((user) => user.role === "admin" && user.isActive).length;
  const instrumentCount = all<{ n: number }>("SELECT COUNT(*) AS n FROM instruments")[0]?.n ?? 0;

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Администрирование</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Доступ и учётные записи. Содержимое чужих портфелей вам не видно — изоляция данных
          действует и для администратора.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Пользователей"
          value={users.length}
          hint={`из них администраторов: ${admins}`}
        />
        <Metric label="Активных инвайтов" value={pending.length} hint="ещё не использованы" />
        <Metric
          label="Портфелей всего"
          value={users.reduce((sum, user) => sum + user.portfolios, 0)}
        />
        <Metric label="Инструментов в справочнике" value={instrumentCount} />
      </div>

      <div className="mt-4">
        <Section
          title="Пользователи"
          subtitle="Роль, доступ, сброс пароля и удаление вместе со всеми данными"
        >
          <div className="mb-5 border-b border-rule pb-5">
            <CreateUser />
          </div>
          <UserTable users={users} currentUserId={admin.id} />
        </Section>
      </div>

      <div className="mt-4">
        <Section
          title="Инвайт-коды"
          subtitle="Второй способ пригласить: человек сам задаёт себе пароль при регистрации"
        >
          <div className="mb-5 border-b border-rule pb-5">
            <InviteCreator />
          </div>

          {invites.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-mute">
              Кодов ещё нет. Создайте код и передайте его — он одноразовый.
            </p>
          ) : (
            <InviteTable invites={invites} />
          )}
        </Section>
      </div>
    </>
  );
}
