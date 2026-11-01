'use client';

import { useState, useMemo, type RefObject } from 'react';
import styles from './CatalogSection.module.css';
import { useCatalog } from '../hooks/useCatalog';
import { useCart } from '../context/CartContext';
import { formatPrice } from '../api/client';
import { getOptimizedImageUrl, handleImageError } from '../utils/images';
import type { CatalogSku } from '../api/schemas';

export interface CatalogSectionProps {
  searchInputRef?: RefObject<HTMLInputElement | null>;
  onSelectProduct: (product: CatalogSku) => void;
  onStartNegotiation: (product: CatalogSku) => void;
  onlySaved: boolean;
  onResetFilters: () => void;
}

export function CatalogSection({
  searchInputRef,
  onSelectProduct,
  onStartNegotiation,
  onlySaved,
  onResetFilters,
}: CatalogSectionProps) {
  const { data: items = [], isLoading, isError, error, refetch } = useCatalog();
  const { saved, toggleSave } = useCart();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [sortBy, setSortBy] = useState<'featured' | 'price-asc' | 'price-desc' | 'name-asc'>('featured');

  // Derive unique categories from live catalog data
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.category && item.category.trim()) {
        set.add(item.category.trim());
      }
    });
    return ['All', ...Array.from(set)];
  }, [items]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let result = [...items];

    // Saved items filter
    if (onlySaved) {
      result = result.filter((item) => saved.includes(item.sku_code));
    }

    // Category filter
    if (selectedCategory !== 'All') {
      result = result.filter(
        (item) => item.category?.toLowerCase() === selectedCategory.toLowerCase()
      );
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.sku_code.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q))
      );
    }

    // Sorting
    if (sortBy === 'price-asc') {
      result.sort((a, b) => a.base_price - b.base_price);
    } else if (sortBy === 'price-desc') {
      result.sort((a, b) => b.base_price - a.base_price);
    } else if (sortBy === 'name-asc') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    }

    return result;
  }, [items, onlySaved, saved, selectedCategory, searchQuery, sortBy]);

  return (
    <section id="collection" className={styles.catalogSection} aria-label="Wholesale collection">
      <div className="wrap">
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>{onlySaved ? 'Saved items' : 'Curated collection'}</h2>
            <p>
              {onlySaved
                ? `Showing ${filteredItems.length} saved item${filteredItems.length === 1 ? '' : 's'}`
                : 'Direct access to verified wholesale goods with real-time price negotiation'}
            </p>
          </div>

          <div className={styles.controls}>
            <div className={styles.searchBox}>
              <svg className={styles.searchIcon} viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              <input
                ref={searchInputRef as any}
                type="search"
                placeholder="Search by name, item code, or details..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search products"
              />
            </div>

            <select
              className={styles.sortSelect}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              aria-label="Sort products"
            >
              <option value="featured">Featured items</option>
              <option value="price-asc">Price: Low to high</option>
              <option value="price-desc">Price: High to low</option>
              <option value="name-asc">Alphabetical: A to Z</option>
            </select>
          </div>
        </div>

        {/* Categories Bar */}
        <div className={styles.categories} role="tablist" aria-label="Product categories">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={selectedCategory === cat}
              className={`${styles.categoryPill} ${selectedCategory === cat ? styles.active : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className={styles.grid}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className={styles.skeletonCard} aria-hidden="true">
                <div className={styles.skeletonImage} />
                <div className={styles.skeletonBody}>
                  <div className={styles.skeletonLine} style={{ width: '40%' }} />
                  <div className={styles.skeletonLine} style={{ width: '80%', height: '20px' }} />
                  <div className={styles.skeletonLine} style={{ width: '60%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actionable Error Retry State */}
        {isError && !isLoading && (
          <div className={styles.stateBox} role="alert">
            <h3>We could not load the catalog</h3>
            <p>
              {error instanceof Error
                ? error.message
                : 'We could not connect right now. Please check your internet connection and try again.'}
            </p>
            <button type="button" className={styles.retryBtn} onClick={() => refetch()}>
              Try again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && filteredItems.length === 0 && (
          <div className={styles.stateBox}>
            <h3>No products found</h3>
            <p>
              {onlySaved
                ? 'You have not saved any items yet.'
                : 'We could not find any products matching your search or filters.'}
            </p>
            {(onlySaved || searchQuery || selectedCategory !== 'All') && (
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                  onResetFilters();
                }}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Live Product Grid */}
        {!isLoading && !isError && filteredItems.length > 0 && (
          <div className={styles.grid}>
            {filteredItems.map((item) => {
              const isSaved = saved.includes(item.sku_code);
              const imageUrl = getOptimizedImageUrl(
                item.Image_url,
                600,
                item.name
              );

              return (
                <article key={item.sku_code} className={styles.card}>
                  <div
                    className={styles.imageWrap}
                    onClick={() => onSelectProduct(item)}
                    role="button"
                    tabIndex={0}
                    aria-label={`View details for ${item.name}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectProduct(item);
                      }
                    }}
                  >
                    <img
                      src={imageUrl}
                      alt={item.name}
                      className={styles.productImg}
                      loading="lazy"
                      onError={(e) => handleImageError(e, item.name)}
                    />
                    <button
                      type="button"
                      className={styles.wishlistBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSave(item.sku_code);
                      }}
                      aria-label={isSaved ? `Remove ${item.name} from saved items` : `Save ${item.name}`}
                      title={isSaved ? 'Remove from saved items' : 'Save for later'}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill={isSaved ? 'var(--green)' : 'none'}
                        stroke={isSaved ? 'var(--green)' : 'var(--ink)'}
                      >
                        <path d="M12 20S2 14 2 7.7C2 2 9 1 12 6c3-5 10-4 10 1.7C22 14 12 20 12 20Z" />
                      </svg>
                    </button>
                  </div>

                  <div className={styles.cardBody}>
                    <span className={styles.categoryTag}>{item.category || 'General'}</span>
                    <h3
                      className={styles.productTitle}
                      onClick={() => onSelectProduct(item)}
                    >
                      {item.name}
                    </h3>
                    <div className={styles.skuCode}>Item code: {item.sku_code}</div>
                    {item.description && (
                      <p className={styles.productDesc}>{item.description}</p>
                    )}

                    <div className={styles.cardFooter}>
                      <div className={styles.priceBlock}>
                        <span className={styles.priceLabel}>Wholesale price</span>
                        <span className={styles.priceValue}>{formatPrice(item.base_price)}</span>
                      </div>

                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.detailsBtn}
                          onClick={() => onSelectProduct(item)}
                        >
                          View details
                        </button>
                        <button
                          type="button"
                          className={styles.offerBtn}
                          onClick={() => onStartNegotiation(item)}
                        >
                          Make an offer
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
