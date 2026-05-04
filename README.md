# N100-BOS | Bastion Engine

**N100-BOS** is a strategy game based on the BASTION engine designed to handle theater-based warfare. The project focuses on creating a "living" battlefield where frontlines aren't just static lines on a map, but dynamic systems that grow, break, and merge based on real-time unit positioning.

### ⚙️ Core Systems & Features

*   **The Maginot Scanner**
    The engine uses a custom scanning system to identify where the highest concentration of troops is located. Instead of manually telling the game where the "front" is, the engine looks for these high-density rows and columns and defines them as the Maginot Line. This acts as the anchor for all AI decisions.

*   **Frontline BFS Logic**
    Once the Maginot Line is established, the engine uses an effecient Breadth-First process to organize units. Starting from units that have successfully engaged the enemy, the system spreads a "Frontline" status to every neighboring unit. This allows the game to recognize multiple, distinct fronts dynamically. If a gap opens up in your formation, the infection stops, and the engine correctly identifies that your line has been split.

*   **Behavioral AI Archetypes**
    The enemy AI operates under three distinct personalities that change how it interacts with the Maginot Line:
    *   **The Berserker**: Focuses on raw power, attacking the strongest points of your line.
    *   **The Strategist**: Searches for "spearheads" and targets the "neck" or the most exposed units with the least support.
    *   **The Predator**: Identifies and hunts down the weakest individual units to create a breakthrough.

*   **Combat & Reinforcement**
    Combat is calculated based on two main factors: **Organization** and **Strength**. Units with high organization can hold their ground longer, while strength determines their damage output and is to be equivalent to the number of troops present in a real-life situation. The engine features a reinforcement mechanic where units in the rear will automatically detect a failing front and move to fill gaps, attempting to keep the Maginot Line intact.

*   **Interactive Grid Engine**
    The map is built on a custom vector-like grid using the Canvas API. It supports 8-directional movement logic (Chebyshev distance), allowing for fluid diagonal maneuvers. I’ve implemented a custom panning and zooming system that maintains coordinate accuracy even as the player scales the view to see the entire theater of war.
