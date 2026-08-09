# Rooms

[← Back to the admin guide](README.md)

## Reaching every room

**Room Config** is where a room is set up rather than run. It opens from the
rail's Manage section, at its own address, carrying the room you already had
open or asking which one.

![The Room Config room picker, as an admin](../images/admin-room-config.png)

What each role finds there:

- a **player** reaches nothing;
- a **GM** reaches the rooms they are GM of;
- an **admin** reaches every room on the server, marked _as admin_, **without
  joining any of them**.

Archived rooms are listed too, and marked. Retiring a room is exactly when
somebody wants to go and tidy it up.

## What "without joining" means

This is the part worth being precise about, because it is a privacy promise as
much as a convenience.

Reaching a room as an admin **does not add you to it**. You appear in no room's
presence, you receive none of its chat, and the players see no sign that you are
there. Membership is untouched.

Inside the panel, and inside the room's own routes, you are treated as the
room's GM — a Library an admin cannot list is not a Library they can manage. So
the two facts to hold together are:

> An admin can see and change anything in any room, and is never _at_ the table
> unless they were invited to it.

One consequence worth knowing: **an admin who genuinely plays in a room sees it
as its GM**, in the game as well as in the panel. There is no way to hold an
admin account and sit at a table as an ordinary player.

## Archiving

Archiving is a GM's action, in the room's own settings, not an admin-only one.
An archived room drops out of the main room list into an **Archived** section
and can be restored from the same place.

Archiving changes nothing about the room's contents. It is a way of saying "not
this campaign, for now".

**Prefer archiving to deleting.** It is the reversible one.

## Deleting a room

**Admins only.** It is in the room's settings, behind a **Permanent deletion**
disclosure, and you must type the room's name to arm the button.

> Delete this room and all of its messages, memberships, and stored room data.
> This cannot be undone.

That is accurate, and broader than it sounds. Deleting a room removes its
uploaded files from disk as well as its rows: every map, scene, reference, and
audio track, plus the portraits belonging to its hirelings and shared assets.

What is _not_ deleted:

- **Accounts.** Members lose the room, not their sign-in.
- **Characters** owned by a player rather than pooled in that room.

There is no undo and no trash. If you are not certain, archive it, and delete it
next month when you still feel the same way.

## Who a room's GM is, and how that changes

A room has exactly two ways of acquiring a GM:

1. **Whoever created it** becomes its GM.
2. **Whoever demotes its GM to player** inherits it — see
   [Accounts](accounts.md#changing-a-role).

That is the whole list. **There is no "make this member the GM" action.** Adding
somebody to a room always adds them as a player, and nothing promotes them
afterwards.

So handing a table from one person to another is awkward, and worth knowing
before you need it. The route that works today:

1. Make the incoming GM a **server admin**.
2. Have **them** demote the outgoing GM to player. The rooms transfer to
   whoever clicks, so they must perform this step themselves — not you.
3. They are now the rooms' GM. You can then set their account role back down to
   game master; that does not disturb the memberships they just gained.

If you would rather not hand out admin, the alternative is for the new GM to
create a fresh room and for the old one to be archived. There is currently no
tidier path.

An admin is never locked out regardless: Room Config reaches every room whether
or not anyone can run it from the inside.

---

[← Accounts](accounts.md) · [Operating the server →](operating.md)
