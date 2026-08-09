# First run

[← Back to the admin guide](README.md)

## Standing the server up

The application is a single Node process that serves the API and the built
client together. From a checkout:

```bash
npm install && npm run build && npm start
```

That serves everything at `http://localhost:4000`. `README.md` in the repository
root covers the alternatives — a development server with hot reload, and running
the bundled `Dockerfile` under WSL Containers on Windows.

Requirements are Node.js 22.5 or newer with npm 10 or newer. The version floor
is not cosmetic: the database is `node:sqlite`, which older runtimes do not
have.

Before you put it in front of anyone, decide where its data lives — see
[Operating the server](operating.md#where-the-data-lives). Moving it later is
easy, but only while you remember it is a decision you made.

## Claiming the first account

Open the server in a browser. With an empty database you are offered a one-time
setup screen rather than a sign-in — the button reads **Create the first GM** —
and that account is made a **server admin** as well as a GM. It is the only
account ever created this way.

- Usernames are 2–32 characters.
- Passwords are at least 8 characters.

There is no email, no confirmation step, and no recovery question. The password
you choose here is the only way back in.

**Claim it immediately.** Between the server starting and you filling in that
form, the setup screen is open to whoever reaches it first. If the server is
reachable from anywhere but your own machine, do not start it and walk away.

Once an account exists the setup route is closed for good and returns
`Server setup is already complete.` It does not reopen if you later delete every
account, so do not.

## What to do next

1. Create the accounts your table needs — see [Accounts](accounts.md). You can
   make them all up front; room access can wait.
2. Make yourself or someone else a **Game master**, then create a room. An admin
   can create rooms too, but the account role that is _for_ running tables is
   game master.
3. Set up the room from **Room Config** — see [Rooms](rooms.md).
4. Send each player an invitation link from inside the room.

## Make a second admin, today

**There is no self-service password change.** Nobody — player, GM, or admin —
can change their own password from inside the application. Every reset is
performed _on_ an account _by_ somebody else, from the Players & characters
screen, which never lists you to yourself.

You also cannot change your own role.

Put those together and a server with one admin has a single point of failure
that no amount of care in the application can rescue: lose that password and
there is no route back in. An admin can reset any other account's password,
including another admin's.

**So make a second admin account now and keep its password somewhere safe.**
That is the difference between an inconvenience and restoring from a backup.
