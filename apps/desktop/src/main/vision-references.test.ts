import { describe, expect, it } from 'vitest';
import { cosineSimilarity, descriptorFromBgra, opponentSlotRect, resolvePokeApiPokemonId } from './vision-references.js';

describe('로컬 포켓몬 이미지 참조', () => {
  it('Champions 상대 패널을 위에서 아래 여섯 슬롯으로 고정 분할한다', () => {
    expect(opponentSlotRect({ width: 1378, height: 768 }, 1)).toEqual({ x: 1150, y: 102, width: 103, height: 82 });
    expect(opponentSlotRect({ width: 1378, height: 768 }, 6)).toEqual({ x: 1150, y: 559, width: 103, height: 82 });
  });

  it('폼 식별자가 정확하면 National Dex보다 PokeAPI 폼 ID를 사용한다', () => {
    expect(resolvePokeApiPokemonId(
      { name: 'Charizard-Mega-X', displayName: '메가리자몽X', nationalDex: 6 },
      [{ id: 6, identifier: 'charizard' }, { id: 10034, identifier: 'charizard-mega-x' }],
    )).toBe(10034);
  });

  it('동일한 특징은 다른 색 특징보다 높은 유사도를 낸다', () => {
    const image = Buffer.alloc(8 * 8 * 4);
    for (let index = 0; index < 8 * 8; index += 1) {
      image[index * 4] = index % 2 ? 220 : 20;
      image[index * 4 + 1] = 60;
      image[index * 4 + 2] = 180;
      image[index * 4 + 3] = 255;
    }
    const different = Buffer.from(image);
    for (let index = 0; index < 8 * 8; index += 1) {
      different[index * 4] = 20;
      different[index * 4 + 1] = 210;
      different[index * 4 + 2] = 30;
    }
    const descriptor = descriptorFromBgra(image, 8, 8, 'capture');
    expect(cosineSimilarity(descriptor, descriptor)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(descriptor, descriptorFromBgra(different, 8, 8, 'capture'))).toBeLessThan(0.95);
  });
});
