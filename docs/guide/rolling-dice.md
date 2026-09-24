# Rolling dice

[← Back to the guide](README.md)

Three ways to roll, all landing in the same place: the table's chat, where the
history reads in order beside what everyone was saying at the time.

## The quick way: type it

In the chat box:

```
/r d20
```

`/roll` works the same. The expression is the ordinary kind — `/r 2d6+1`,
`/r 3d8`. This is the fastest route when you know what you want.

## The dice box

The dice button beside the send arrow, or **Dice** on a phone's bottom bar.

![The dice box](images/dice.png)

Across the top, what _kind_ of roll this is. The names come from your system —
Cairn offers **Free roll**, **Save**, and **Damage** — and choosing one sets the
box up the way that system's rules describe, rather than leaving you to
translate them into dice.

Then the dice themselves: how many, which die, and a modifier. **Roll 1d20** at
the bottom says exactly what is about to happen before it happens.

**Read rolling rules** opens the rulebook at the part that governs the roll you
are setting up.

## 3D dice

The GM can enable **3D dice** in **Room settings**. It starts off for each room.
Once enabled, rolls appear across the main table area; on a phone with Chat or
Combat open, they use that panel instead. They do not block clicks, map controls,
or the chat composer. Results still appear in text immediately.

Dice bounce off the tray edges, tumble across the floor, and knock into each
other before settling. The throw takes about 2.6 seconds. The server chooses the
result; the motion lands on that recorded number without changing face labels.

Open the dice box and expand **Your 3D dice** to turn animations off for yourself,
choose a set, or customize the body, numbers, accent, and finish. Press **Save dice
preferences** to remember the choice for your account across rooms and devices.
The GM has the same personal controls. Disabling and re-enabling the room does
not reset anyone's preference.

The six sets match the app themes with their light/dark balance reversed: dark
themes have pale dice, and light themes have dark dice. **Match room theme** follows
the room palette; selecting a named set keeps it fixed. Other viewers see the
roller's set. Your on/off preference only affects your screen.

Available dice are d3, d4, d5, d6, d7, d8, d10, d12, d14, d16, d20, d24, d30,
d44, d66, d100, and the percentile tens die d%10. All faces are numeric. The
d3/d5/d7 use barrels with repeated values, and d4 reads at its upper tip.

- `d100` or `/r d%` rolls a full percentile result with two dice. 00 + 0 is 100.
- `d%10` rolls just the tens die: 00, 10, …, 90. It takes a count but no modifier
  or keep/drop suffix.
- d44 and d66 use two component dice, read as tens and units.
- Keep/drop rolls show every die; dropped dice fade after landing.
- A system can provide numeric custom dice in the **System die** selector. They
  remain usable when 3D animation is off.

Private and invisible rolls retain their normal audience. Seeing a notice that
someone rolled does not reveal their dice. Reduced-motion settings and devices
without WebGL use a brief text result. Busy periods may skip older visual effects;
the rolls and their recorded results are unaffected. Textured skins are planned
for a later release.

## From your sheet

The dice icon beside an attribute on your character sheet opens this same box,
already pointed at that attribute with its target filled in. See
[Your character](your-character.md).

## From the combat tracker

While a fight is running, your weapon's damage can be rolled from beside your
name in the tracker. See [Combat](combat.md).

## Who sees the roll

Two choices at the bottom of the box:

|              | What the table sees                                           |
| ------------ | ------------------------------------------------------------- |
| **Standard** | Everything: that you rolled, what you rolled, and the result. |
| **Private**  | That a roll happened. The result goes to you and the GM only. |

Private is for the roll whose _outcome_ is yours to know but whose _existence_
is not a secret — you looked for a trap, and whether you found one is not for
the table to read off a number.

There is a third setting, **invisible**, which tells the table nothing at all.
That one is the GM's; it is how they roll behind the screen.

Which one you picked is marked on the message, so nobody has to wonder later
whether a result was the whole story.

## Next

[Combat →](combat.md)
