"""
Grid Search Parameter Optimization

Tests all parameter combinations to find optimal values
"""
import json
import time
from pathlib import Path
from typing import Dict, List, Any
import itertools
import sys

# Add parent to path
sys.path.append(str(Path(__file__).parent.parent))
from tests.utils.metrics_collector import MetricsCollector


class GridSearchOptimizer:
    """
    Performs grid search over parameter space to find optimal configuration
    """

    def __init__(self, output_dir: Path):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.results: List[Dict[str, Any]] = []

    def define_parameter_space(self) -> Dict[str, List[Any]]:
        """
        Define the parameter space to search

        Returns:
            Dictionary mapping parameter names to list of values to test
        """
        return {
            'silence_threshold_ms': list(range(500, 3001, 250)),  # 500, 750, ..., 3000
            'backchannel_duration_threshold_ms': list(range(300, 1001, 100)),  # 300, 400, ..., 1000
            'backchannel_intensity_threshold': [0.02, 0.03, 0.04, 0.05, 0.06],
            'barge_in_threshold_ms': [200, 300, 400, 500],
        }

    def set_config(self, params: Dict[str, Any]):
        """
        Set application configuration with given parameters

        Args:
            params: Dictionary of parameters to set
        """
        # TODO: Implement actual config setting via API or config file
        # For now, this is a placeholder
        print(f"  Setting config: {params}")

    def run_test_suite(self, params: Dict[str, Any]) -> Dict[str, float]:
        """
        Run test suite with given parameters and return metrics

        Args:
            params: Parameters to test

        Returns:
            Dictionary of metric scores
        """
        # TODO: Actually run tests with these parameters
        # For now, simulate with placeholder scores

        # Placeholder scoring (replace with actual test runs)
        import random
        random.seed(hash(frozenset(params.items())))  # Deterministic "randomness"

        # Simulate metrics
        metrics = {
            'turn_taking_accuracy': 0.85 + random.random() * 0.10,
            'false_interruption_rate': 0.05 + random.random() * 0.10,
            'avg_latency_ms': 1200 + random.random() * 800,
            'stt_wer': 0.02 + random.random() * 0.03,
        }

        return metrics

    def calculate_objective_score(self, metrics: Dict[str, float]) -> float:
        """
        Calculate composite objective score from metrics

        Args:
            metrics: Dictionary of metric values

        Returns:
            Objective score (higher is better)
        """
        # Weighted combination of metrics
        score = (
            metrics.get('turn_taking_accuracy', 0) * 0.4 +
            (1 - metrics.get('false_interruption_rate', 0)) * 0.3 +
            (1 - min(metrics.get('avg_latency_ms', 2000) / 3000, 1.0)) * 0.2 +
            (1 - metrics.get('stt_wer', 0) * 10) * 0.1
        )

        return score

    def grid_search(self) -> Dict[str, Any]:
        """
        Perform grid search over all parameter combinations

        Returns:
            Dictionary with best parameters and results
        """
        param_space = self.define_parameter_space()

        # Generate all combinations
        keys = list(param_space.keys())
        values = [param_space[k] for k in keys]
        combinations = list(itertools.product(*values))

        total_combinations = len(combinations)
        print(f"\n{'='*80}")
        print(f"GRID SEARCH OPTIMIZATION")
        print(f"{'='*80}")
        print(f"Parameter space:")
        for k, v in param_space.items():
            print(f"  {k}: {len(v)} values")
        print(f"\nTotal combinations: {total_combinations}")
        print(f"{'='*80}\n")

        # Estimate time
        if total_combinations > 100:
            print(f"⚠️  Warning: {total_combinations} combinations may take a long time")
            print(f"   Consider reducing parameter space or using Bayesian optimization")

        start_time = time.time()

        # Test each combination
        for i, combo in enumerate(combinations, 1):
            params = dict(zip(keys, combo))

            print(f"\n[{i}/{total_combinations}] Testing combination:")
            for k, v in params.items():
                print(f"  {k}: {v}")

            # Set config
            self.set_config(params)

            # Run tests
            metrics = self.run_test_suite(params)

            # Calculate score
            score = self.calculate_objective_score(metrics)

            # Store result
            result = {
                'params': params,
                'metrics': metrics,
                'score': score
            }
            self.results.append(result)

            print(f"  Score: {score:.4f}")
            print(f"  Metrics: {json.dumps(metrics, indent=4)}")

            # Save intermediate results
            if i % 10 == 0:
                self.save_results()

        elapsed = time.time() - start_time
        print(f"\n{'='*80}")
        print(f"Grid search completed in {elapsed:.1f}s")
        print(f"{'='*80}")

        # Find best
        best = max(self.results, key=lambda x: x['score'])

        print(f"\n🏆 BEST PARAMETERS:")
        print(f"{'='*80}")
        print(f"Score: {best['score']:.4f}\n")
        print("Parameters:")
        for k, v in best['params'].items():
            print(f"  {k}: {v}")
        print("\nMetrics:")
        for k, v in best['metrics'].items():
            if isinstance(v, float):
                print(f"  {k}: {v:.4f}")
            else:
                print(f"  {k}: {v}")
        print(f"{'='*80}\n")

        # Save final results
        self.save_results()

        return best

    def save_results(self):
        """Save results to file"""
        output_file = self.output_dir / "grid_search_results.json"

        with open(output_file, 'w') as f:
            json.dump({
                'results': self.results,
                'best': max(self.results, key=lambda x: x['score']) if self.results else None,
                'total_combinations': len(self.results)
            }, f, indent=2)

        print(f"Results saved to: {output_file}")

    def plot_results(self):
        """Plot grid search results (requires matplotlib)"""
        try:
            import matplotlib.pyplot as plt
            import numpy as np

            # Extract scores for each parameter
            param_space = self.define_parameter_space()

            fig, axes = plt.subplots(2, 2, figsize=(12, 10))
            axes = axes.flatten()

            param_names = list(param_space.keys())

            for i, param_name in enumerate(param_names[:4]):
                ax = axes[i]

                # Group results by parameter value
                param_values = {}
                for result in self.results:
                    val = result['params'][param_name]
                    if val not in param_values:
                        param_values[val] = []
                    param_values[val].append(result['score'])

                # Calculate mean score for each value
                x_vals = sorted(param_values.keys())
                y_vals = [np.mean(param_values[x]) for x in x_vals]

                ax.plot(x_vals, y_vals, 'o-', linewidth=2, markersize=6)
                ax.set_xlabel(param_name)
                ax.set_ylabel('Score')
                ax.set_title(f'{param_name} vs Score')
                ax.grid(True, alpha=0.3)

            plt.tight_layout()
            plot_file = self.output_dir / "grid_search_plot.png"
            plt.savefig(plot_file, dpi=150)
            print(f"Plot saved to: {plot_file}")

        except ImportError:
            print("matplotlib not available, skipping plot")


def main():
    """Main entry point"""
    output_dir = Path(__file__).parent / "results"

    optimizer = GridSearchOptimizer(output_dir)
    best = optimizer.grid_search()

    # Try to plot
    optimizer.plot_results()

    print("\n✓ Grid search optimization complete")


if __name__ == "__main__":
    main()
