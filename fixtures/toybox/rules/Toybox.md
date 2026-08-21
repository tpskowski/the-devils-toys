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

Six slots. A bulky item takes two. Coin is counted rather than carried and takes
no slot at all.

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

### Names (d6)

Two given names and a family name. Take either given name — the application is
asked to pick one of the two columns rather than one of two tables, which is a
thing a book does and a thing worth having a fixture for.

| d6 | Given Name | Chosen Name | Family Name |
| --- | --- | --- | --- |
| 1 | Ames | Salt | Underhill |
| 2 | Byrd | Ember | Marchbank |
| 3 | Crane | Quill | Ashdown |
| 4 | Dell | Tally | Fenwick |
| 5 | Ewe | Nine | Rookwood |
| 6 | Frost | Bell | Stollen |

### Guild Knacks (d6)

One of two knack tables, and the player says which. The application is asked to
pick one of two *tables* here rather than one of two columns, and to let the
person building the character make that pick rather than the dice — which is
what a book means when it prints three name tables and expects you to know which
one you are.

<!-- tags: character-building -->

| d6 | Knack |
| --- | --- |
| 1 | **Cooperage:** You can tell a sound barrel from a leaking one by the sound of a knuckle on it. |
| 2 | **Ledgers:** You read a merchant's books faster than the merchant does. |
| 3 | **Apprentice's Ear:** You remember every instruction you were ever given badly. |
| 4 | **Guild Word:** One guildhall in any town will hear you out. |
| 5 | **Steady Hands:** Nothing you are carrying has ever been dropped. |
| 6 | **Short Measure:** You know exactly how much is missing. |

### Road Knacks (d6)

The other one. Its rows are written the way the first one's are — a bolded name,
a colon, and what it does — because that is how a book writes a talent, and the
application takes the name off the front of it when the result is filed as one.

<!-- tags: character-building -->

| d6 | Knack |
| --- | --- |
| 1 | **Weatherwise:** You know what the sky is going to do before it does it. |
| 2 | **Night Walking:** You keep a road under your feet in the dark. |
| 3 | **Cold Camp:** You can sleep anywhere once. |
| 4 | **Toll Dodging:** You know where every gate is not. |
| 5 | **Common Tongue:** You can make yourself understood two valleys over. |
| 6 | **Long Wind:** You can walk all day and talk all of it. |

### Odds and Ends (d6)

One thing you have carried since before any of this. It is offered into a slot
rather than put in one: the catalogue knows some of these and not others, and a
slot holds a plain string either way.

| d6 | Item |
| --- | --- |
| 1 | Lantern |
| 2 | Crowbar |
| 3 | Chalk and twine |
| 4 | Hand Axe |
| 5 | Rope, 50 feet |
| 6 | A brick, in a sock |

## Trades

What a character did before the delving. The trades are headings rather than a
table, so the application enumerates them out of the book and the system package
restates none of them. Roll d4 or take the one you want.

Each trade owns one table, and that table is read at the Hit Protection already
rolled rather than rolled again. One roll, two tables — which is what a creation
step means when it takes its total from an earlier one.

### Cooper

#### About

Barrels, casks, and anything that has to hold water. A cooper counts a thing
twice and is usually right about it.

#### Kit

- Crowbar
- Chalk and twine

#### Cooper's Keepsake (d6)

| d6 | Keepsake |
| --- | --- |
| 1 | A hoop that fits nothing you own |
| 2 | The first stave you ever shaped |
| 3 | A mallet with somebody else's name on it |
| 4 | A cellar key, and no cellar |
| 5 | A ledger of casks unaccounted for |
| 6 | Sand from a barrel that held no sand |

### Drayman

#### About

Loads, roads, and the animals that mind neither. A drayman knows what a thing
weighs before it is lifted.

#### Kit

- Rope, 50 feet
- Lantern

#### Drayman's Keepsake (d6)

| d6 | Keepsake |
| --- | --- |
| 1 | A harness bell that stopped ringing |
| 2 | A toll receipt for a bridge that fell |
| 3 | Half a map, folded to the half you need |
| 4 | A whip you have never used |
| 5 | The last consignment note, unsigned |
| 6 | A stone the horse would not walk past |

### Fletcher

#### About

Shafts, flights, and the patience for both. A fletcher will tell you the wind is
wrong and be right about that too.

#### Kit

- Hand Axe
- Chalk and twine

#### Fletcher's Keepsake (d6)

| d6 | Keepsake |
| --- | --- |
| 1 | A shaft that came back on its own |
| 2 | Feathers from a bird nobody can name |
| 3 | A bowstring gone slack, kept anyway |
| 4 | A target board with one hole in it |
| 5 | A splinter, still in the thumb |
| 6 | A quiver counted short every morning |

### Glazier

#### About

Glass, lead, and light let in on purpose. A glazier is the only one who looks up
in a room worth robbing.

#### Kit

- Lantern
- Crowbar

#### Glazier's Keepsake (d6)

| d6 | Keepsake |
| --- | --- |
| 1 | A pane you have never dared cut |
| 2 | Lead came, coiled like rope |
| 3 | A window's worth of somebody's face |
| 4 | Grozing pliers, worn smooth |
| 5 | A colour you have not been able to mix since |
| 6 | The offcut that drew blood |

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
