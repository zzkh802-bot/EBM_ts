# Domain context

## Patient Profile

A user-controlled record for one real person. It contains only confirmed identity and stable health context: display name, sex, age, allergy history, pregnancy status, and optional long-term notes. A user may maintain several Patient Profiles for themselves or family members.

## Visit Preparation Session

An isolated multi-turn conversation linked to exactly one Patient Profile. Its purpose is to help that person express one upcoming visit clearly. It may read the linked Patient Profile and Profile Memory, and it produces one archived Visit Report. It never shares Pi conversation state with another session.

## Profile Memory

User-visible, user-editable stable context attached to one Patient Profile. It is supplied to that profile's future Visit Preparation Sessions. Conversation text and model inference do not automatically become Profile Memory.

## Visit Report

The final Markdown summary produced from one Visit Preparation Session. It is archived on the server and retained with the local session so the user can reopen and copy it. It contains only information the user supplied, with unknowns left explicit.

## Free Chat Session

An isolated, no-memory conversation that is not linked to a Patient Profile, does not create a Visit Report, and permits at most five user turns. It provides bounded health education and first-aid or prevention information, but does not make a definitive diagnosis or provide an individualized prescription.
