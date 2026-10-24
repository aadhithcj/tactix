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
    # Per-team framing of the dilemma, keyed by StatsBomb team name.
    dilemmas: dict[str, str] = field(default_factory=dict)
    subs_allowed: int = 5
    second: int = 0


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
)


def catalog_by_slug() -> dict[str, ScenarioSpec]:
    return {spec.slug: spec for spec in CATALOG}
