# The Devil's Toys — Admin's Guide

This is the guide for whoever **runs the server**. It covers the things only a
server admin can do, and the things nobody else will do for you.

If you are playing at a table, you want the [Player's Guide](../README.md); if
you are running one, the [GM's Guide](../gm/README.md).

## Three roles, and what each one is for

Every account has exactly one **account role**. It is not the same thing as
being a room's GM — that is a per-room membership, and the two are set in
different places.

| Account role     | Can                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Player**       | Play. Nothing about the server or other accounts.                                                                                         |
| **Game master**  | Everything a player can, plus create rooms, run the rooms they are GM of, create **player-level accounts only**, and write random tables. |
| **Server admin** | Everything, on every room, without joining any of them.                                                                                   |

The distinction that catches people out: **a GM is a role you hold at a table;
an admin is a role you hold over the server.** A GM who is not an admin cannot
promote anyone, cannot reach a room they were not made GM of, and cannot delete
a room at all.

## What only an admin can do

- Create accounts above player level, and change any account's role
  ([Accounts](accounts.md)).
- Reset any password, including another admin's ([Accounts](accounts.md)).
- Open **Room Config** for every room on the server, without being a member
  ([Rooms](rooms.md)).
- Delete a room, and everything it owns ([Rooms](rooms.md)).
- Install, update, export, retire, restore, and remove game systems
  ([Game systems](systems.md)).
- In The Devil's Tables: merge, retire, and re-slug tags, and produce a
  repository bundle ([Operating the server](operating.md)).

Everything else on this list — starting the server, moving the data directory,
taking backups — is not permission-gated at all. It is yours because you are the
one with the shell.

## Pages

1. **[First run](first-run.md)** — standing the server up and claiming the
   first account.
2. **[Accounts](accounts.md)** — roles, invitations, passwords, and handing a
   room over.
3. **[Rooms](rooms.md)** — reaching every room, and deleting one.
4. **[Game systems](systems.md)** — installing, updating, exporting, retiring,
   and removing runtime system bundles.
5. **[Operating the server](operating.md)** — configuration, storage, backups,
   logs, and the table editor.

## One warning before you start

This is alpha software. Data shapes still change between versions, and
migrations run automatically when the server starts. **Take a backup before you
upgrade** — see [Operating the server](operating.md#backups). There is no
downgrade path.
