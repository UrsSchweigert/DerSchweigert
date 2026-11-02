class_name AnswerMode
extends RefCounted
## Decides how a band's answer is entered and models free numeric entry.
##
## A band declares [code]answerFormat[/code] and may declare
## [code]freeEntryMastery[/code]. A multiple-choice band starts with orbs and
## switches to free entry once the learner's mastery reaches that threshold, so
## the shift is data-defined and rises with mastery. Numeric bands always use
## free entry.

const KIND_ORBS: String = "orbs"
const KIND_NUMERIC: String = "numeric"
const MULTIPLE_CHOICE: String = "multiple_choice"
const MIN_ORBS: int = 2
const MAX_ORBS: int = 4
const DEFAULT_FREE_ENTRY_MASTERY: float = 0.75


## Returns [code]{kind, orbs}[/code] for [param band] at [param mastery].
## [code]orbs[/code] counts the answer plus [param distractor_count] distractors
## and is zero for free entry.
func resolve(band: Dictionary, mastery: float, distractor_count: int = 3) -> Dictionary:
	if String(band.get("answerFormat", KIND_NUMERIC)) != MULTIPLE_CHOICE:
		return {"kind": KIND_NUMERIC, "orbs": 0}
	if mastery >= free_entry_mastery(band):
		return {"kind": KIND_NUMERIC, "orbs": 0}
	return {"kind": KIND_ORBS, "orbs": orb_count(distractor_count)}


## Returns the mastery at which [param band] switches to free entry. An absent
## or unusable value falls back to [constant DEFAULT_FREE_ENTRY_MASTERY].
func free_entry_mastery(band: Dictionary) -> float:
	var value: Variant = band.get("freeEntryMastery", DEFAULT_FREE_ENTRY_MASTERY)
	if not (value is int or value is float):
		return DEFAULT_FREE_ENTRY_MASTERY
	var threshold: float = float(value)
	if threshold <= 0.0 or threshold > 1.0:
		return DEFAULT_FREE_ENTRY_MASTERY
	return threshold


## Clamps a distractor count to the two to four choices a band shows.
func orb_count(distractor_count: int) -> int:
	return clampi(distractor_count + 1, MIN_ORBS, MAX_ORBS)


## Holds the digits a learner types for free entry.
class NumericEntry:
	extends RefCounted

	const MAX_DIGITS: int = 5

	var _digits: String = ""

	## Appends one decimal digit and returns whether it was accepted.
	## Non-numeric text and a sixth digit are rejected.
	func push(character: String) -> bool:
		if character.length() != 1:
			return false
		var code: int = character.unicode_at(0)
		if code < 48 or code > 57:
			return false
		if _digits.length() >= MAX_DIGITS:
			return false
		_digits += character
		return true

	## Removes the last digit and returns whether anything was removed.
	func delete() -> bool:
		if _digits.is_empty():
			return false
		_digits = _digits.substr(0, _digits.length() - 1)
		return true

	## Removes every digit.
	func clear() -> void:
		_digits = ""

	## Returns the digits typed so far.
	func text() -> String:
		return _digits

	## Returns how many digits are typed.
	func length() -> int:
		return _digits.length()

	## Returns whether no digit is typed.
	func is_empty() -> bool:
		return _digits.is_empty()

	## Returns whether five digits are typed.
	func is_full() -> bool:
		return _digits.length() >= MAX_DIGITS

	## Returns the typed value, or -1 while the entry is empty.
	func confirm() -> int:
		if _digits.is_empty():
			return -1
		return int(_digits)
