"""Curated playable moments.

Each entry freezes a StatsBomb open-data match at a minute. The snapshot
builder derives everything else (players on the pitch, positions, bench,
threat maps, what really happened) from the event data, so adding a match is
a matter of adding an entry here, or later generating one from any match.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ScenarioSpec:
    slug: str
    match_id: int
    competition_id: int
    season_id: int
    minute: int
    title: str
    tagline: str
    venue: str
    # Per-team framing of the dilemma, keyed by StatsBomb team name. The first
    # team listed is the side the home page puts you in charge of.
    dilemmas: dict[str, str] = field(default_factory=dict)
    subs_allowed: int = 5
    second: int = 0
    # What kind of game it is, in words: "World Cup final", "Champions League final".
    occasion: str = ""
    # Curated moments rotate as the home page hero. Built-on-demand ones don't.
    featured: bool = True
    # Hand-written home page copy per team (headline, hook, ask). Teams without
    # it get copy written by Gemini at seed time, or a plain template.
    hero: dict[str, dict[str, str]] = field(default_factory=dict)


CATALOG: tuple[ScenarioSpec, ...] = (
    ScenarioSpec(
        slug="lusail-2022-71",
        match_id=3869685,
        competition_id=43,
        season_id=106,
        minute=71,
        second=27,
        title="Twenty minutes from glory",
        tagline=(
            "Argentina have controlled the World Cup Final. France have barely had a "
            "shot, and Deschamps has just thrown on Coman and Camavinga."
        ),
        venue="Lusail Stadium, Qatar",
        occasion="World Cup final",
        hero={
            "Argentina": {
                "headline": "It’s 2–0 in a World Cup final. Don’t blow it.",
                "hook": "France have barely had a shot, but Mbappé is still out there.",
                "ask": "How do you protect the lead?",
            },
            "France": {
                "headline": "2–0 down in a World Cup final. Save it.",
                "hook": "Twenty minutes left, barely a shot all game, and Messi has already scored.",
                "ask": "How do you get back into it?",
            },
        },
        dilemmas={
            "Argentina": (
                "You lead 2–0 and France look beaten. But Mbappé is still on the pitch. "
                "Do you close the game down, or keep hunting a third?"
            ),
            "France": (
                "Two down, almost nothing created, and the trophy is slipping away. "
                "Something has to change before the clock does it for you."
            ),
        },
    ),
    ScenarioSpec(
        slug="moscow-2018-60",
        match_id=8658,
        competition_id=43,
        season_id=3,
        minute=60,
        title="Croatia's last push",
        tagline=(
            "Croatia have out-passed France for an hour and still trail 3–1 after "
            "Pogba's strike. Thirty minutes left in Moscow."
        ),
        venue="Luzhniki Stadium, Moscow",
        occasion="World Cup final",
        hero={
            "Croatia": {
                "headline": '3–1 down in a World Cup final. Now or never.',
                "hook": "You've had the ball for an hour. France have had the goals.",
                "ask": 'How do you get back into it?',
            },
            "France": {
                "headline": '3–1 up in a World Cup final. Finish the job.',
                "hook": 'Croatia keep coming, and Mbappé is waiting to run in behind.',
                "ask": 'How do you see it out?',
            },
        },
        dilemmas={
            "Croatia": (
                "You've had the ball, France have had the goals. Do you throw bodies "
                "forward and risk the counter, or keep probing?"
            ),
            "France": (
                "3–1 up, and Croatia keep coming. Mbappé is itching to run into the "
                "space behind them. How do you see this out?"
            ),
        },
        subs_allowed=3,
    ),
    ScenarioSpec(
        slug="wembley-2021-60",
        match_id=3795506,
        competition_id=55,
        season_id=43,
        minute=60,
        title="Wembley holds its breath",
        tagline=(
            "Shaw scored in the second minute. Since then England have retreated and "
            "Italy have taken over the ball."
        ),
        venue="Wembley Stadium, London",
        occasion="Euro final",
        hero={
            "England": {
                "headline": '1–0 up in a home Euro final. Hold your nerve.',
                "hook": 'Shaw scored in the second minute. Italy have had the ball ever since.',
                "ask": 'Sit tight, or push back up?',
            },
            "Italy": {
                "headline": '1–0 down at Wembley. Find a way through.',
                "hook": "You're dominating the ball, but England's back five won't crack.",
                "ask": 'How do you unlock them?',
            },
        },
        dilemmas={
            "England": (
                "1–0 up in a home final, but Italy are camped in your half. Sit tighter, "
                "or push back up the pitch before the pressure breaks you?"
            ),
            "Italy": (
                "A goal down and dominating the ball, but England's back five won't "
                "crack. How do you unlock them?"
            ),
        },
    ),
    ScenarioSpec(
        slug="berlin-2024-75",
        match_id=3943043,
        competition_id=55,
        season_id=282,
        minute=75,
        title="Level in Berlin",
        tagline=(
            "Palmer has just equalised off the bench. Spain have been the better side, "
            "but momentum has swung."
        ),
        venue="Olympiastadion, Berlin",
        occasion="Euro final",
        hero={
            "Spain": {
                "headline": "1–1 in a Euro final. You've been better. Prove it.",
                "hook": 'Palmer has just equalised, and Yamal and Williams are still out wide.',
                "ask": 'Go for the winner?',
            },
            "England": {
                "headline": "1–1 in a Euro final. The crowd's awake.",
                "hook": "Palmer's equaliser off the bench has turned the game.",
                "ask": 'Stay compact, or go after Spain?',
            },
        },
        dilemmas={
            "Spain": (
                "You've been the better side and it's 1–1. Yamal and Williams are still "
                "out wide. Go for the winner, or settle and avoid extra time chaos?"
            ),
            "England": (
                "You're level and the crowd has woken up. Do you stay in the low block "
                "that kept you alive, or go after a tired Spain?"
            ),
        },
    ),
    ScenarioSpec(
        slug="istanbul-2005-50",
        match_id=2302764,
        competition_id=16,
        season_id=37,
        minute=50,
        title="Three down in Istanbul",
        tagline=(
            "Maldini scored in the first minute and Crespo added two before the break. "
            "Liverpool trail 3–0 in the Champions League final with 40 minutes left."
        ),
        venue="Atatürk Olympic Stadium, Istanbul",
        occasion="Champions League final",
        hero={
            "Liverpool": {
                "headline": '3–0 down in a Champions League final. Forty minutes left.',
                "hook": 'Maldini scored in the first minute. Crespo added two before the break.',
                "ask": 'What do you change?',
            },
            "AC Milan": {
                "headline": "3–0 up in a Champions League final. Don't get comfortable.",
                "hook": 'Liverpool have nothing to lose now.',
                "ask": 'Sit on it, or kill it off?',
            },
        },
        dilemmas={
            "Liverpool": (
                "3–0 down in a European final and Milan have been ruthless. Throw "
                "everything forward, or tighten up and keep it respectable?"
            ),
            "AC Milan": (
                "3–0 up and cruising. Liverpool have to come at you now. Sit on "
                "the lead, or keep hunting the fourth?"
            ),
        },
        subs_allowed=3,
    ),
    ScenarioSpec(
        slug="munich-2012-84",
        match_id=18237,
        competition_id=16,
        season_id=23,
        minute=84,
        title="Bayern's final, at home",
        tagline=(
            "Thomas Müller headed Bayern in front on 83 minutes at their own stadium. "
            "Chelsea, outplayed for most of the night, have one push left."
        ),
        venue="Allianz Arena, Munich",
        occasion="Champions League final",
        hero={
            "Chelsea": {
                "headline": '1–0 down in a Champions League final, in their stadium.',
                "hook": 'Müller has just headed Bayern in front. Six minutes left.',
                "ask": 'How do you find an equaliser?',
            },
            "Bayern Munich": {
                "headline": '1–0 up in a final, at home. Six minutes to go.',
                "hook": 'Müller has just put you in front, and Chelsea have barely threatened.',
                "ask": 'Close it out, or go for two?',
            },
        },
        dilemmas={
            "Chelsea": (
                "Müller has just put Bayern ahead in their own stadium. Six minutes "
                "of a Champions League final left. How do you find an equaliser?"
            ),
            "Bayern Munich": (
                "1–0 up at home with minutes to go. Chelsea have barely threatened. "
                "Close it out, or go for the second?"
            ),
        },
        subs_allowed=3,
    ),
    ScenarioSpec(
        slug="lisbon-2014-85",
        match_id=18241,
        competition_id=16,
        season_id=25,
        minute=85,
        title="Five minutes from history",
        tagline=(
            "Diego Godín's first-half header has Atlético on the brink of their "
            "first European Cup. Real Madrid need a goal."
        ),
        venue="Estádio da Luz, Lisbon",
        occasion="Champions League final",
        hero={
            "Real Madrid": {
                "headline": '1–0 down in a Champions League final. Five minutes left.',
                "hook": "Godín's header has Atlético on the brink of their first European Cup.",
                "ask": 'How do you break them down?',
            },
            "Atlético Madrid": {
                "headline": '1–0 up. Five minutes from your first European Cup.',
                "hook": 'Real Madrid are about to throw everyone forward.',
                "ask": 'Hold the line, or hit them on the break?',
            },
        },
        dilemmas={
            "Real Madrid": (
                "Atlético lead 1–0 and five minutes are left in the final. How "
                "do you break down Simeone's defence?"
            ),
            "Atlético Madrid": (
                "1–0 up, five minutes from your first European Cup. Real will throw "
                "everyone forward. Hold the line, or hit them on the break?"
            ),
        },
        subs_allowed=3,
    ),
    ScenarioSpec(
        slug="lusail-2022-saudi-60",
        match_id=3857300,
        competition_id=43,
        season_id=106,
        minute=60,
        title="A shock in Lusail",
        tagline=(
            "Messi's early penalty looked like the start of a routine World Cup opener. "
            "Then Saudi Arabia scored twice in five minutes."
        ),
        venue="Lusail Stadium, Qatar",
        occasion="World Cup group game",
        hero={
            "Argentina": {
                "headline": '2–1 down to Saudi Arabia at the World Cup. Fix it.',
                "hook": 'Two Saudi goals in five minutes after the break turned your opener upside down.',
                "ask": 'What do you change?',
            },
            "Saudi Arabia": {
                "headline": "2–1 up against Messi's Argentina. Thirty minutes left.",
                "hook": 'Your high line has frustrated them all game.',
                "ask": 'Hold on, or keep squeezing?',
            },
        },
        dilemmas={
            "Argentina": (
                "Saudi Arabia scored twice in five minutes after the break and lead "
                "2–1. Thirty minutes to save your opening World Cup game."
            ),
            "Saudi Arabia": (
                "You lead Argentina 2–1 at the World Cup. Thirty minutes to hold on. "
                "Sit deep, or keep squeezing them high up the pitch?"
            ),
        },
    ),
)


def catalog_by_slug() -> dict[str, ScenarioSpec]:
    return {spec.slug: spec for spec in CATALOG}
