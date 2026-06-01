# UI Redesign Phase 2: "Smart Search" & Course Page

## 1. Overview
**Goal:** Transform the minimal prototype into a feature-rich course discovery platform.
**Concept:** "The Smart Course Catalog" — treating courses like products with clear quality/difficulty metrics and "purchase options" (sections/instructors).

## 2. Tech Stack
- **Framework:** React + Vite (Existing)
- **UI Library:** [Mantine v8](https://mantine.dev/) (New)
  - *Why:* Robust data display components, modern hooks, unstyled/styled flexibility.
- **Routing:** React Router v6+ (New)
  - *Why:* Essential for shareable course links (`/course/CS/128`).
- **Icons:** Tabler Icons (Standard for Mantine).

## 3. Architecture

### 3.1 Routing Structure
```
/                   -> Search Dashboard (Home)
/course/:subject/:number -> Course Details Page (Product Page)
```

### 3.2 State Management strategy
- **URL as Source of Truth:**
  - Search state (`?q=cs&gened=ACP&diff=easy`) lives in the URL.
  - This ensures browser "Back" button works perfectly when returning from a course page.
- **Client Cache:**
  - Use `react-query` or simple `swr` (optional, or stick to simple `useEffect` for now) to cache course details so navigating back/forth is instant.

## 4. Key Components (Design Specs)

### 4.1 Global Layout (`AppShell`)
- **Header:** Sticky. Contains Logo ("UIUC Course Search") and a condensed Search Bar (on course pages).
- **Theme:** UIUC Orange & Blue accents, clean sans-serif typography.

### 4.2 Search Dashboard (`/`)
- **Hero Section:** Large Search Bar for the "Home" state.
- **Filters Panel:**
  - `MultiSelect` for GenEds (e.g., "Humanities", "Quant 1").
  - `RangeSlider` for Difficulty (1-5 scale).
  - `SegmentedControl` for Term (e.g., "Fall 2023", "Spring 2024").
- **Course Card (List Item):**
  - **Header:** Subject + Number (e.g., "CS 225") and Title.
  - **Badges:** "Smart Grade" (e.g., A-, B+) based on Quality Score.
  - **Snippet:** Shortened description.
  - **Metadata:** Credits, GenEd badges.

### 4.3 Course Details Page (`/course/:subject/:number`)
**Layout Strategy:** Two-Column Layout (Desktop) / Stacked (Mobile).

**A. The "Product" Header:**
- Big Title: "Data Structures"
- **The Scorecard (Hero Metric):**
  - **Visual:** A large "Letter Grade" (e.g., **A**).
  - **Quadrant Chart:** A scatter plot using Mantine charts or simple SVG.
    - X: Difficulty, Y: Quality.
    - **Context:** Plot the current course as a *Blue Dot*. Plot other dept courses as *Gray Dots*. This answers: "Is this hard *for a CS class*?"

**B. The "Specs" (Details):**
- Description (full text).
- GenEd requirements fulfilled.
- Credit hours.

**C. The "Variations" (Section Table):**
- A table listing available sections.
- **Columns:**
  - `Instructor` (with RMP link/rating if matched).
  - `Time/Location`
  - `GPA` (Average GPA for this instructor).
  - `Status` (Open/Closed - if available in future, placeholder for now).
- **Sorting:** Default sort by "Smart Rank" (Best combo of GPA + RMP).

## 5. Implementation Plan

### Phase 1: Foundation
1. **Dependencies:** Install `@mantine/core @mantine/hooks @tabler/icons-react react-router-dom`.
2. **Setup:** Wrap `App` in `MantineProvider` and `BrowserRouter`.
3. **Refactor:** Move existing Search logic into `pages/SearchPage.tsx`.

### Phase 2: Course Page (The "Product")
1. **API Integration:** Create `useCourse(subject, number)` hook fetching from `/api/course/:subject/:number`.
2. **Scorecard Component:** Implement the Logic to calculate Letter Grade from `quality_score`.
3. **Quadrant Chart:** Build a simple reusable Chart component for the Quality vs. Difficulty visualization.
4. **Section Table:** Implement the Instructor list with RMP/GPA columns.

### Phase 3: Search Upgrade
1. **Filters:** Add Mantine inputs for GenEds and Difficulty.
2. **URL Sync:** Ensure changing filters updates the URL params.

## 6. Data Requirements (Gap Analysis)
- **API:** `/api/course/:subject/:number` exists.
- **Context Data:** To plot the "Gray Dots" (dept context), the frontend needs stats for *other* courses.
  - *Workaround:* We might need to fetch a lightweight "Dept Stats" list, or just hardcode/approximate the context for V1.
