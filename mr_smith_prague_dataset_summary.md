# Mr Smith Prague Dataset Summary

This document describes all known information from the test dataset related to Mr. Smith.
The dataset is used for testing hybrid retrieval (memory + external knowledge).

Sources include:

- Gmail messages
- Slack / chat messages
- Local files
- Notes created during testing

The goal of the dataset is to verify that the assistant can:

- use personal context
- combine it with external knowledge
- recommend restaurants
- respect preferences
- respect health restrictions
- avoid hallucination

This file must be used as the source of truth for automated test generation.

---

# Sources

## Gmail

Emails contain information about Mr. Smith.

Topics present:

- Mr. Smith lives in Prague
- Mr. Smith has food preferences
- Mr. Smith may have health restrictions
- emails mention restaurant recommendations
- emails mention Asian food
- emails mention Korean BBQ
- emails mention healthy food

Emails define main personal context.

---

## Slack / chat messages

Messages contain additional notes.

Topics present:

- discussion about suitable restaurants
- discussion about dietary restrictions
- discussion about Prague restaurants
- discussion about cuisine types

Messages may contain partial information.

---

## Files

Files contain notes about Mr. Smith.

Topics present:

- preferences
- location
- health conditions
- restaurant types
- recommendations

Files confirm the same facts as emails.

---

# Combined Knowledge

The dataset describes a person named Mr. Smith.

Facts known:

- Mr. Smith is in Prague
- Mr. Smith likes Asian food
- Mr. Smith likes Korean BBQ
- Mr. Smith prefers healthy food
- Mr. Smith may have a chronic condition
- restaurants must fit his preferences
- recommendations must be based on Prague

Assistant must combine:

personal context + external knowledge

External knowledge includes:

- real restaurants
- cuisine types
- diet recommendations
- restaurant reviews
- location knowledge

---

# Facts

FACT: person_name = Mr Smith  
FACT: location = Prague  
FACT: country = Czech Republic

FACT: preference_asian_food = true  
FACT: preference_korean_bbq = true  
FACT: preference_healthy_food = true

FACT: dietary_restriction_possible = true  
FACT: chronic_condition_possible = true

FACT: restaurant_recommendation_required = true  
FACT: restaurants_must_be_in_prague = true

FACT: assistant_must_use_external_knowledge = true  
FACT: assistant_must_use_personal_context = true

FACT: query_type = hybrid_context_external

Facts must be used for validation.

---

# Not Present

These features do not exist in the dataset.

NOT_PRESENT: New York location  
NOT_PRESENT: London location  
NOT_PRESENT: vegetarian_only  
NOT_PRESENT: vegan_only  
NOT_PRESENT: seafood_only  
NOT_PRESENT: Italian_only  
NOT_PRESENT: allergies_to_nuts  
NOT_PRESENT: allergies_to_gluten  
NOT_PRESENT: fast_food_preference  
NOT_PRESENT: fast_food_required

If assistant mentions these as facts, it is hallucination.

External knowledge may mention them as options,
but must not claim they are known facts.

---

# Conflicts

Some messages contain incomplete information.

Examples:

Preference conflict:

- one message mentions Asian food
- another mentions Korean BBQ
- another mentions healthy food

All are valid and must be combined.

Health condition:

- not always confirmed
- but possible
- assistant should consider safe choices

Location:

- Prague always confirmed
- recommendations must use Prague

Restaurant selection:

- must match preferences
- must match location
- must respect health condition if relevant

Conflicts must be resolved using all sources.

---

# Expected Assistant Behaviour

When answering questions about restaurants:

Assistant must:

- use Mr Smith preferences
- use Prague location
- use external knowledge about restaurants
- combine both

Assistant must not:

- ignore preferences
- ignore location
- invent allergies
- invent cuisines
- invent cities

Assistant must support hybrid reasoning.

---

# Instructions for Test Generator AI

This file must be used as the reference dataset.

When generating tests:

1. Use only facts from this file.
2. Use Facts section for keyword validation.
3. Use Not Present section for negative tests.
4. Use Conflicts section for hybrid tests.
5. Use Combined Knowledge for multi-step tests.

Test types to generate:

- context + external tests
- restaurant recommendation tests
- hybrid retrieval tests
- contradiction tests
- hallucination tests
- multi-step queries

For hybrid tests:

Answer must contain:

- context facts
- external knowledge
- correct location
- correct preferences

For negative tests:

Assistant must say data not found
or must not invent facts.

This file is the only trusted source.