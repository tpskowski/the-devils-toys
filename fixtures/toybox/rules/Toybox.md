# Toybox

A game system that exists so the application can be tested without one.

Nothing here is meant to be played. Every heading, table, and statblock below is
standing in for the shape of a real system's: a priced gear table so the
catalogue seeder has something to read, a vice table so the vice catalogue has a
column to find, a bestiary so the statblock parser has entries to parse, and two
rollable tables so the table catalogue is not empty.

It is written from nothing and reprints no book, which is the point — the
application's own tests must not depend on anyone's rules text.

## Playing

### Saves

Roll d20 against an ability. Equal or under succeeds. A 1 always succeeds and a
20 always fails.

Muscle is force. Nerve is composure. Knack is everything else.

### Hit Protection

Damage comes off Hit Protection first. At 0, the remainder comes off Muscle.

### Inventory

Six slots. A bulky item takes two.

## Character Creation

Roll each ability on 3d6 and Hit Protection on 1d6. Take a trade and a vice.

### Name & Trade (d6)

<!-- tags: character-building -->

| d6 | Name | Trade |
| --- | --- | --- |
| 1 | Ames | Cooper |
| 2 | Byrd | Drayman |
| 3 | Crane | Fletcher |
| 4 | Dell | Glazier |
| 5 | Ewe | Miller |
| 6 | Frost | Tanner |

### Vices (d6)

| d6 | Vice | Triggered by | Satisfied by |
| --- | --- | --- | --- |
| 1 | Drink | Idleness | A full night and a full purse |
| 2 | Boasting | An audience | Being believed |
| 3 | Hoarding | Anything unattended | Counting it twice |
| 4 | Grudges | Being corrected | An apology, or worse |
| 5 | Gambling | A wager offered | Winning, then leaving |
| 6 | Sleep | Warmth | Eight hours nobody interrupts |

## Oracles

Tables to roll on in play. They are also the suite's corpus for reading,
serializing, and re-reading a table, so between them they cover the shapes the
parser has to handle: banded rows, a single column, and several columns at once.

### What the Door Is (d20)

| d20 | Result |
| --- | --- |
| 1-5 | Locked, and the key is nearby |
| 6-10 | Barred from the other side |
| 11-15 | Ajar, which is worse |
| 16-19 | Not a door |
| 20 | Open, and something came through |

### Weather (d6)

| d6 | Sky | Wind | Underfoot |
| --- | --- | --- | --- |
| 1 | Clear | Still | Dry |
| 2 | Overcast | Rising | Damp |
| 3 | Drizzle | Gusting | Slick |
| 4 | Rain | Steady | Running |
| 5 | Fog | Still | Soft |
| 6 | Storm | Howling | Flooded |

### Complications (d10)

| d10 | Complication |
| --- | --- |
| 1 | The lantern is running low |
| 2 | Someone else has been here |
| 3 | The way back is shorter than it was |
| 4 | A sound repeats at intervals |
| 5 | The chalk marks are wrong |
| 6 | Water where there was none |
| 7 | A door that was open |
| 8 | The rope is fraying |
| 9 | Two sets of prints, one bare |
| 10 | Nothing, and that is the complication |

### What Went Wrong (d66)

A d66 is read as two dice, not as a sixty-six-sided one.

| d66 | Result |
| --- | --- |
| 11-16 | The plan was always thin |
| 21-26 | Someone talked |
| 31-36 | The map was old |
| 41-46 | It was never here |
| 51-56 | It was here, and is not now |
| 61-66 | It is still here |

## Gear

| WEAPONS | COST |
| --- | --- |
| Cudgel (d6) A stick with intent. | 5 |
| Hand Axe (d6, thrown) | 8 |
| Longblade (d8, bulky) | 20 |
| Sling (d6, ranged) Stones are free. | 6 |

| TOOLS | COST |
| --- | --- |
| Lantern | 10 |
| Rope, 50 feet (bulky) | 12 |
| Crowbar | 7 |
| Chalk and twine | 1 |

### Gear Properties

- **Bulky:** Takes two inventory slots rather than one.

- **Thrown:** May be used at range once, and is then wherever it landed.

- **Ranged:** Reaches anything the wielder can see.

- **Sweep:** (Bulky) Long weapons that reach a second adjacent enemy on a hit.

- **Armour Piercing (AP):** Ignores armour. Damage rolls of 1 glance off instead.

## STARSHIP PARTS

The gang's wagon, and what can be bolted to it. The heading is the one the
application looks for; a delve has no starships, and the code does not care what
the asset is called.

| WHEELS | COST |
| --- | --- |
| Iron-Shod Wheels (+2 hull) | 200 |
| Spare Axle | 60 |

| FITTINGS | COST |
| --- | --- |
| Strongbox (bulky) | 150 |
| Awning | 40 |
| **Driver's Bench:** Seats two out of the weather. | 80 |

## Bestiary

### Tin Rat

*3 HP, 4 Muscle, 10 Nerve, 12 Knack, bite (d4)*

- Never alone.
- Flees light.

### Chalk Golem

*10 HP, 2 Armor, 14 Muscle, 6 Nerve, 4 Knack, fist (d8)*

- Crumbles in rain.
- Critical damage: the victim is marked, and the next golem knows it.
