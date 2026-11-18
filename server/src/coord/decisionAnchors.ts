// Overlord W2, the decision model's anchor sets (spec 2026-11-09 §3.7 H6; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 9, question 10). Ring: L1 data, context Coordination
// (C5): no store, no clock, no I/O, and types only from the catalogue.
//
// TWENTY PUBLIC, SYNTHETIC STATES PER ROW. The anchor-set lane re-asks them once a day and reads each answer's band. Their
// sole use is to notice the model moving under the server (drift: 4 of 20 in another band than the line's baseline), so they
// are fixed text, never learned from the operator and never taken from a real session. Every sentence is made up, about made-up
// programmes, in plain words: no real project, person, product or company is named, and the repository's private-name scan
// reads them like any other text (`decision-model-lane.test.ts`).
//
// `expected` IS THE BAND AT AUTHORING: what a sensible model's probability would read. For a yes-or-no row it is the band of
// the chance of `yes`. For `programme.pick` it is the band of the chance of the option the model names (`none` included, when
// no listed programme fits). It is a record of how the set was meant to read and a spread across the four bands, so a set
// that all reads one band cannot hide a move; the lane compares each day with the line's baseline, never with this field.
//
// EVERY STATE IS COMPLETE for its row's catalogue fields: each required field present and non-empty, `candidates` and `goals`
// the same length (2 to 4) on the routing rows, and each `fact` field under `DECISION_FACT_MAX_CHARS`.
import type { DecisionBand, DecisionRowId } from '../../../shared/decisionModel.js';
import type { DecisionFields } from './decisionModel.js';

export interface DecisionAnchor { readonly fields: DecisionFields; readonly expected: DecisionBand }

const U: DecisionBand = 'unlikely';
const D: DecisionBand = 'doubtful';
const L: DecisionBand = 'likely';
const V: DecisionBand = 'very-likely';

/** The made-up programmes the routing rows pick among: slug and goals. */
const PROGRAMMES: Readonly<Record<string, string>> = {
  'orchardplanner': 'Plan the planting, pruning and harvest rounds of a community orchard.',
  'bridgesurvey': 'Survey and record the condition of the footbridges along the river path.',
  'kitchenrota': 'Share out the weekly cooking duties in a shared house.',
  'seedlibrary': 'Lend out and catalogue vegetable seeds to the neighbours.',
  'toolshare': 'Keep a shared shed of garden tools and note who has borrowed what.',
  'weatherlog': 'Record the daily rainfall and temperature from a rooftop station.',
  'choirnotes': 'Keep the sheet music and the rehearsal dates for a village choir.',
  'bikerepair': 'Run a monthly workshop that mends bicycles for free.',
  'mapclub': 'Draw and update a hand-made map of the footpaths in the parish.',
  'bookswap': 'Run a street box where people swap paperback books.',
};

/** One routing state: the request, the shortlist (slugs of `PROGRAMMES`, in order), and the bands of the two routing rows. */
type Route = readonly [request: string, slugs: readonly string[], pick: DecisionBand, any: DecisionBand];
const ROUTES: readonly Route[] = [
  ['Add the new apple varieties to the planting schedule.', ['orchardplanner', 'seedlibrary'], V, V],
  ['Record the cracked plank on the second footbridge.', ['bridgesurvey', 'mapclub'], V, V],
  ['Swap the Tuesday and Thursday cooking nights for the spring term.', ['kitchenrota', 'toolshare'], V, V],
  ['Order more bean and pea seeds before the sowing weekend.', ['seedlibrary', 'orchardplanner', 'toolshare'], L, V],
  ['Mark who borrowed the long-handled shears last week.', ['toolshare', 'seedlibrary'], V, V],
  ['Fill the gap in the rainfall figures for last Sunday.', ['weatherlog', 'bridgesurvey'], V, V],
  ['Print the alto part for the new carol.', ['choirnotes', 'bookswap'], V, V],
  ['Hold an extra workshop for the children\'s bicycles.', ['bikerepair', 'kitchenrota'], V, V],
  ['Redraw the stile that moved on the north field path.', ['mapclub', 'bridgesurvey'], L, V],
  ['Put out a crate of crime novels on the corner.', ['bookswap', 'choirnotes'], V, V],
  ['Plan a quiet evening of board games for the neighbours.', ['kitchenrota', 'bookswap', 'choirnotes'], V, U],
  ['Buy a new roof for the village hall.', ['toolshare', 'kitchenrota'], V, U],
  ['Compare the rain gauge with the neighbour\'s figures and note the difference.', ['weatherlog', 'mapclub'], L, L],
  ['Tidy up the shed and the seed tins.', ['toolshare', 'seedlibrary'], D, V],
  ['Share the pruning job between the two groups.', ['orchardplanner', 'toolshare', 'kitchenrota'], L, V],
  ['Tell people the river path is closed for a week.', ['bridgesurvey', 'mapclub', 'weatherlog'], D, L],
  ['Teach the new members how to read the rehearsal list.', ['choirnotes', 'kitchenrota'], L, V],
  ['Is it going to be a good year for pears?', ['orchardplanner', 'weatherlog', 'seedlibrary'], D, L],
  ['Write a thank-you note to the helpers.', ['kitchenrota', 'bikerepair', 'choirnotes', 'bookswap'], U, D],
  ['Change the opening hours.', ['bookswap', 'bikerepair', 'toolshare'], D, D],
];
const routing = (which: 2 | 3): readonly DecisionAnchor[] => ROUTES.map((r) => ({
  fields: { request: r[0], candidates: r[1], goals: r[1].map((s) => PROGRAMMES[s]!) },
  expected: r[which],
}));

const scope: readonly (readonly [cited: string, goals: string, expected: DecisionBand])[] = [
  ['Please also cover the east side of the park.', 'Plant and care for the orchard on both sides of the park.', V],
  ['Keep going as you are.', 'Add a second orchard on the hill.', U],
  ['Yes, include the hill as well.', 'Care for the orchard and the hill planting.', V],
  ['Maybe later we can think about the hill.', 'Care for the orchard and the hill planting.', D],
  ['Do the pears first.', 'Plant pears and apples in the first year.', L],
  ['Add the swimming pond to the survey.', 'Survey the footbridges and the swimming pond.', V],
  ['The footbridges are enough for now.', 'Survey the footbridges and the swimming pond.', U],
  ['Could the choir also sing at the market?', 'Keep the music and sing at the weekly market.', L],
  ['I like the market idea, but it is not a task yet.', 'Keep the music and sing at the weekly market.', D],
  ['Stop at the rota for the weekdays.', 'Share cooking on weekdays and weekends.', U],
  ['Weekends need a rota as well.', 'Share cooking on weekdays and weekends.', V],
  ['Nobody said anything about tools.', 'Lend seeds and keep a tool shed.', U],
  ['Lend the tools too, please.', 'Lend seeds and keep a tool shed.', V],
  ['Perhaps the rain gauge could go on the school roof.', 'Record the weather from the rooftop and the school.', L],
  ['The school roof is out of the question.', 'Record the weather from the rooftop and the school.', U],
  ['Fix the bikes of the neighbours as well.', 'Mend bicycles for the club and for the neighbours.', V],
  ['Only the club bikes this year.', 'Mend bicycles for the club and for the neighbours.', U],
  ['Drawing the cycle lanes would be nice.', 'Draw the footpaths and the cycle lanes.', D],
  ['Yes, draw the cycle lanes too.', 'Draw the footpaths and the cycle lanes.', V],
  ['We have not decided about the second street box.', 'Run two street boxes for swapping books.', D],
];
const scopeAnchors: readonly DecisionAnchor[] = scope.map(([cited, goals, expected]) => ({ fields: { cited, goals }, expected }));

const relay: readonly (readonly [part: string, expected: DecisionBand])[] = [
  ['Sort the list first, then walk it from the end, and keep a spare table for the counts.', V],
  ['We want the list to show the newest entry first.', U],
  ['Use two passes: one to collect the names and one to write them out.', V],
  ['The page should load in under a second on a slow phone.', U],
  ['Call the helper twice and compare the answers before you save.', L],
  ['Make the button bigger.', U],
  ['Put the check in the loop, not before it, and stop at the first miss.', V],
  ['Neighbours must be able to see the list without signing in.', U],
  ['Write the file in small pieces and join them at the end.', V],
  ['Keep the old behaviour for existing members.', U],
  ['Start with the smallest case, then add the others one at a time.', L],
  ['The report should say how many were skipped.', U],
  ['Read the whole folder into memory, then filter it with a regular expression.', V],
  ['Please keep it simple.', D],
  ['Name the new part after the old one so people can find it.', D],
  ['Try the quick method first and fall back to the slow one if it fails.', L],
  ['The total has to match the sum of the lines.', U],
  ['Split the work into three steps and give each step its own test.', L],
  ['Use whatever is easiest.', D],
  ['Add a small cache in front of the lookup and clear it every hour.', V],
];
const relayAnchors: readonly DecisionAnchor[] = relay.map(([part, expected]) => ({ fields: { part }, expected }));

/** Readback states: the request, the readback, a short done test, and the bands of the two readback rows. */
type Back = readonly [request: string, readback: string, doneTest: string, omits: DecisionBand, adds: DecisionBand];
const BACKS: readonly Back[] = [
  ['Add a sign-up sheet and a reminder note.', 'I will add a sign-up sheet and a reminder note.', 'Both appear on the page.', U, U],
  ['Add a sign-up sheet and a reminder note.', 'I will add a sign-up sheet.', 'Both appear on the page.', V, U],
  ['Add a sign-up sheet and a reminder note.', 'I will add a sign-up sheet, a reminder note and a waiting list.', 'Both appear on the page.', U, V],
  ['Rename the club and update the poster.', 'I will rename the club and update the poster.', 'The poster shows the new name.', U, U],
  ['Rename the club and update the poster.', 'I will rename the club.', 'The poster shows the new name.', V, U],
  ['Rename the club and update the poster.', 'I will rename the club, update the poster and email every member.', 'The poster shows the new name.', U, V],
  ['Count the books and list the damaged ones.', 'I will count the books and list the damaged ones.', 'The list matches the shelf.', U, U],
  ['Count the books and list the damaged ones.', 'I will count the books.', 'The list matches the shelf.', V, U],
  ['Move the rota to Mondays.', 'I will move the rota to Mondays and tell the house.', 'The new day is on the board.', U, L],
  ['Move the rota to Mondays.', 'I will tell the house about the rota.', 'The new day is on the board.', L, U],
  ['Plant the beans and water them daily.', 'I will plant the beans.', 'The beans are up in two weeks.', L, U],
  ['Plant the beans and water them daily.', 'I will plant the beans, water them daily and build a fence.', 'The beans are up in two weeks.', U, L],
  ['Draw the north path on the map.', 'I will draw the north path on the map.', 'The path is on the map.', U, U],
  ['Draw the north path on the map.', 'I will draw the south path on the map.', 'The path is on the map.', V, V],
  ['Send the notes to the choir.', 'I will send some of the notes to the choir.', 'Everyone has the notes.', D, U],
  ['Send the notes to the choir.', 'I will send the notes to the choir and the band.', 'Everyone has the notes.', U, D],
  ['Fix the squeak and oil the chain.', 'I will fix the squeak and probably oil the chain.', 'The bike runs quietly.', D, D],
  ['Fix the squeak and oil the chain.', 'I will oil the chain and fix the squeak.', 'The bike runs quietly.', U, U],
  ['Write down the rain figures for May.', 'I will write down the rain figures for May and June.', 'May is complete.', U, D],
  ['Write down the rain figures for May.', 'I will write down the rain figures.', 'May is complete.', D, U],
];
const backs = (which: 3 | 4): readonly DecisionAnchor[] => BACKS.map((b) => ({
  fields: { request: b[0], readback: b[1], doneTest: b[2] }, expected: b[which],
}));

const conflict: readonly (readonly [a: string, b: string, signal: string, expected: DecisionBand])[] = [
  ['Keep the orchard quiet and free of visitors.', 'Open the orchard to visitors every weekend.', 'Both name the orchard.', V],
  ['Plant more apple trees along the path.', 'Keep the path clear and wide.', 'Both name the path.', L],
  ['Grow vegetables in the shared garden.', 'Keep the shared garden as a lawn for games.', 'Both name the garden.', V],
  ['Lend the shears to anyone who asks.', 'Keep the shears locked and used by trained people only.', 'Both name the shears.', V],
  ['Sing at the market on Saturdays.', 'Keep Saturdays free for rest.', 'Both name Saturday.', D],
  ['Record the rain every day.', 'Draw the footpaths of the parish.', 'No shared place.', U],
  ['Mend bicycles for free.', 'Sell second-hand bicycles to pay for the shed.', 'Both name bicycles.', L],
  ['Share the cooking evenly.', 'Let the best cook do all the cooking.', 'Both name the cooking.', V],
  ['Swap books in the street box.', 'Keep a catalogue of seeds.', 'No shared place.', U],
  ['Close the river path for repairs.', 'Hold the walking day on the river path.', 'Both name the river path.', V],
  ['Keep the hall open late.', 'Keep the hall quiet after eight.', 'Both name the hall.', L],
  ['Print the music in colour.', 'Save paper and print in black and white.', 'Both name printing.', L],
  ['Water the beans every day.', 'Save water during the dry weeks.', 'Both name water.', D],
  ['Teach the children to mend bicycles.', 'Let only adults use the tools.', 'Both name the tools.', L],
  ['Meet on the first Monday.', 'Meet on the last Friday.', 'Both name the meeting.', D],
  ['Measure the rainfall from the roof.', 'Measure the rainfall from the school.', 'Two places, one aim.', U],
  ['Collect old paperbacks.', 'Collect old maps.', 'No shared place.', U],
  ['Prune the old trees hard.', 'Leave the old trees untouched for the birds.', 'Both name the old trees.', V],
  ['Welcome new members every month.', 'Keep the group small.', 'Both name membership.', L],
  ['Plan the harvest for September.', 'Plan the harvest for October.', 'Both name the harvest.', D],
];
const conflictAnchors: readonly DecisionAnchor[] = conflict.map(([a, b, signal, expected]) => ({ fields: { a, b, signal }, expected }));

/** Each row's 20 anchors (`DECISION_ANCHOR_COUNT`), in the order the lane asks them and records their bands. */
export const DECISION_ANCHORS: { readonly [K in DecisionRowId]: readonly DecisionAnchor[] } = {
  'programme.pick': routing(2),
  'programme.any': routing(3),
  'scope.widens': scopeAnchors,
  'relay.method': relayAnchors,
  'readback.omits': backs(3),
  'readback.adds': backs(4),
  'goals.conflict': conflictAnchors,
};
