# Next Task: Course Page Design & UI Refresh

We have just completed the backend infrastructure for "Smart Search" (RateMyProfessor sync, Contextual Scoring, and Advanced Filtering). The backend is robust, but the frontend (`apps/web`) is still a minimal prototype.

## Objective
Design and plan the implementation of a modern, feature-rich **Individual Course Page** and a **Search UI Redesign** that exposes the new data we have unlocked.

## Key Requirements to Brainstorm

### 1. Individual Course Page (`/course/[subject]/[number]`)
The current API returns rich data that is not displayed. We need a design that visualizes:
*   **"The Scorecard"**: Prominently display the new `Quality Score` and `Difficulty Score` (e.g., circular progress bars, color-coded badges).
*   **Instructor Breakdown**: Show the specific RMP rating and GPA for *each* instructor teaching this semester. Help students choose *which* section to take.
*   **Historical Trends**: A chart showing GPA trends over time (using `gpa_stats` data).
*   **GenEd Badges**: Clear indicators of which requirements this course satisfies.

### 2. Search UI Redesign
The search bar needs to evolve into a "Search Experience".
*   **Filter Controls**: UI toggles for "Easy/Hard", "GenEd Categories", and "Time of Day" (using the new backend filters).
*   **Result Cards**: Redesign the course card to show the "Smart Score" at a glance.
*   **"Explained" Results**: If a result is boosted by RMP scores or semantic similarity, visually indicate *why* it ranked high.

### 3. Technical Considerations
*   **Routing**: We currently use a single-page list. We need a proper router (React Router or similar) for `/course/:id` pages.
*   **State Management**: How do we persist search state when navigating back from a course page?
*   **Performance**: The `gpa_stats` payload can be large. How do we load it efficiently (lazy loading charts)?

## Your Task
1.  **Analyze** the current `apps/web` structure.
2.  **Brainstorm** the UX/UI layout for the Course Page and Search Filters.
3.  **Create a Plan** (`docs/plans/ui-redesign.md`) breaking down the work into components (e.g., `CourseScoreCard`, `InstructorTable`, `SearchFiltersSidebar`).
4.  **Prototype** the key components if possible.

*Start by exploring `apps/web` to see what we have to work with.*
