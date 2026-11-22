---
name: Daily Stars
description: The Family Notebook visual system for a private household points tracker.
colors:
  forest-green: "#365842"
  soft-green: "#e6eddc"
  warm-paper: "#f7f5ef"
  cream-surface: "#fdfcf8"
  deep-ink: "#293d35"
  muted-ink: "#59665e"
  muted-gold: "#8a681f"
  soft-border: "#dce1d5"
  field-border: "#778b79"
  white: "#fff"
typography:
  page-title:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(26px, 7vw, 32px)"
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  display:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(42px, 11vw, 58px)"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "-2px"
  headline:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    lineHeight: 1.4
    letterSpacing: "-0.3px"
  title:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.6
  label:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
  caption:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
rounded:
  control: "12px"
  container: "22px"
spacing:
  small: "8px"
  medium: "20px"
components:
  button-primary:
    backgroundColor: "{colors.forest-green}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    height: "44px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.forest-green}"
    rounded: "{rounded.control}"
    height: "44px"
  field-text:
    backgroundColor: "{colors.white}"
    textColor: "{colors.deep-ink}"
    rounded: "{rounded.control}"
    padding: "10px"
    height: "44px"
  card:
    backgroundColor: "{colors.cream-surface}"
    textColor: "{colors.deep-ink}"
    rounded: "{rounded.container}"
    padding: "20px"
---

# Design System: Daily Stars

## Overview

**Creative North Star: "The Family Notebook"**

Daily Stars feels calm, warm, practical, and lightly playful. Its narrow reading column, paper-toned surfaces, forest-green actions, and small star mark suggest a household record that parents can return to every day. The interface stays approachable and dependable when it presents forms, dates, and saved state.

The system is softly layered through a warm page background, lighter panels, quiet borders, and a lifted open menu. The gold accent adds a small moment of warmth without competing with actions.

**Key Characteristics:**
- A compact phone-first column with generous space around the welcome message.
- Warm paper and cream surfaces with forest-green actions.
- Rounded panels and controls, with visible keyboard focus.

## Colors

The palette pairs warm neutrals with a restrained green action color and a muted gold accent. Frontmatter values are the normative token values.

### Primary
- **Forest Green:** Primary buttons, selected tabs and navigation items, and link-like controls.
- **Soft Green:** The small star tile, count badges, and hover feedback on secondary controls.

### Secondary
- **Muted Gold:** Keyboard focus outlines and the small empty-state star.

### Neutral
- **Warm Paper:** Page background.
- **Cream Surface:** Cards, dialogs, and the open navigation menu.
- **Deep Ink:** Main text.
- **Muted Ink:** Supporting text, dates, and footer copy.
- **Soft Border:** Panel edges and list dividers.
- **Field Border:** Text input outlines and save-status borders.
- **White:** Primary button text and field backgrounds.

**The One Action Color Rule.** Use Forest Green for actionable and selected states; keep Muted Gold for focus and small accents.

## Typography

**Display Font:** System sans-serif stack.
**Body Font:** The same system sans-serif stack.

**Character:** Direct and readable. Larger headings use tight tracking; labels and supporting text remain compact without sacrificing legibility.

### Hierarchy
- **Page title:** Responsive management-screen heading.
- **Display:** Responsive, semibold heading for the welcome screen.
- **Headline:** Section headings, including profile state headings.
- **Title:** Child names and dialog headings.
- **Body:** Main prose and form values.
- **Label:** Buttons, dates, helper text, and form labels. The welcome eyebrow is a smaller uppercase accent with wide tracking.
- **Caption:** Small date and count text.

## Layout

The application sits in one centered column capped at 660px, with 24px horizontal page padding and at least a 280px viewport width. The welcome screen has more top space than task screens. Forms and lists use flexible rows that wrap on narrow phones or with long names. The shared spacing tokens are a small 8px gap and a medium 20px gap; larger panel padding and section gaps are set where needed.

## Elevation & Depth

The page, panels, and fields form soft tonal layers. Borders define resting panels; only the open navigation menu has a shadow in the current implementation. Keep the overall feeling softly layered while reserving visible lift for an overlay that needs separation.

### Shadow Vocabulary
- **Open menu:** `0 8px 24px rgb(25 44 34 / 12%)` separates the menu from the page.

## Shapes

Controls and fields use gently curved 12px corners. Larger cards and dialogs use 22px corners. Thin borders outline light surfaces and divide list rows; the small star tile repeats the control radius.

## Components

### Buttons
- **Primary:** Forest Green fill, white text, 44px minimum height, and gently curved corners. The profile action uses slightly wider padding than child-management actions.
- **Outline:** The menu toggle, Manage actions, and recovery link use a green outline or transparent fill.
- **States:** Disabled controls fade. Keyboard focus uses a 3px Muted Gold outline with 3px offset.

### Cards / Containers
- **Style:** Cream panels on Warm Paper with a Soft Border and 22px corners. Child rows are divided by a thin line inside a single panel.

### Inputs / Fields
- **Style:** White fields, a Field Border, 12px corners, and at least 44px height. Checkboxes use Forest Green as their accent.
- **Focus:** Use the same clear gold outline as buttons.

### Navigation
- **Style:** A green-outlined 44px menu control opens a cream menu above the page. Menu links are full-height targets; the current page has a Forest Green fill and white text.

### Tabs
- **Style:** Active and archived child tabs use transparent green text at rest, then green fill and white text when selected. A small count badge keeps the number visible in both states.

## Do's and Don'ts

### Do:
- **Do** keep actions and selected states consistently green.
- **Do** use the light surface and quiet border for task panels, with visible focus on every control.
- **Do** allow long child names and form content to wrap inside the phone column.

### Don't:
- **Don't** use the gold accent as a second primary action color.
- **Don't** add resting shadows to every card; use tonal layers and borders first.
- **Don't** replace the system type stack or current corner language when extending the incumbent interface.
