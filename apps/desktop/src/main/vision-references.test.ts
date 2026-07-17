import { describe, expect, it } from 'vitest';
import { cosineSimilarity, descriptorFromBgra, detectChampionTypesFromBgra, detectOpponentSlotRectsFromBgra, opponentSlotContextRect, opponentSlotRect, resolvePokeApiPokemonId, templateSimilarityFromBgra, visionSeedSourceGroups } from './vision-references.js';

describe('로컬 포켓몬 이미지 참조', () => {
  it('패널 검출 실패 시 Full Screen 기준 포켓몬 렌더 영역으로 분할한다', () => {
    expect(opponentSlotRect({ width: 1378, height: 768 }, 1)).toEqual({ x: 1098, y: 122, width: 104, height: 76 });
    expect(opponentSlotRect({ width: 1378, height: 768 }, 6)).toEqual({ x: 1098, y: 537, width: 104, height: 76 });
  });

  it('포켓몬 렌더 영역에서 타입과 성별을 포함한 전체 상대 카드 영역을 복원한다', () => {
    expect(opponentSlotContextRect(
      { width: 1919, height: 1075 },
      { x: 1530, y: 170, width: 143, height: 110 },
    )).toEqual({ x: 1494, y: 170, width: 275, height: 110 });
  });

  it('카드 오른쪽 위의 타입 색상 두 개를 왼쪽부터 판독한다', () => {
    const width = 275;
    const height = 110;
    const bitmap = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      bitmap[index * 4] = 48;
      bitmap[index * 4 + 1] = 10;
      bitmap[index * 4 + 2] = 96;
      bitmap[index * 4 + 3] = 255;
    }
    const fill = (startX: number, red: number, green: number, blue: number): void => {
      for (let y = 10; y < 50; y += 1) {
        for (let x = startX; x < startX + 36; x += 1) {
          const offset = (y * width + x) * 4;
          bitmap[offset] = blue;
          bitmap[offset + 1] = green;
          bitmap[offset + 2] = red;
        }
      }
    };
    fill(185, 96, 160, 184);
    fill(229, 176, 168, 128);
    expect(detectChampionTypesFromBgra(bitmap, width, height)).toEqual(['Steel', 'Rock']);
  });

  it('투명 HOME 렌더 템플릿을 같은 위치의 카드 이미지와 더 높게 매칭한다', () => {
    const template = Buffer.alloc(96 * 96 * 4);
    const different = Buffer.alloc(96 * 96 * 4);
    const capture = Buffer.alloc(124 * 96 * 4);
    for (let index = 0; index < 124 * 96; index += 1) {
      capture[index * 4] = 50;
      capture[index * 4 + 1] = 12;
      capture[index * 4 + 2] = 100;
      capture[index * 4 + 3] = 255;
    }
    for (let y = 20; y < 76; y += 1) {
      for (let x = 24; x < 72; x += 1) {
        const templateOffset = (y * 96 + x) * 4;
        template[templateOffset] = 220;
        template[templateOffset + 1] = 150;
        template[templateOffset + 2] = 40;
        template[templateOffset + 3] = 255;
        different[templateOffset] = 30;
        different[templateOffset + 1] = 220;
        different[templateOffset + 2] = 210;
        different[templateOffset + 3] = 255;
        const captureOffset = (y * 124 + x + 14) * 4;
        capture[captureOffset] = 220;
        capture[captureOffset + 1] = 150;
        capture[captureOffset + 2] = 40;
      }
    }
    expect(templateSimilarityFromBgra(capture, 124, 96, template, 96, 96))
      .toBeGreaterThan(templateSimilarityFromBgra(capture, 124, 96, different, 96, 96));
  });

  it('창 테두리와 작업 표시줄이 포함된 Full Screen에서도 상대 카드 여섯 줄의 포켓몬 영역을 찾는다', () => {
    const width = 1919;
    const height = 1075;
    const bitmap = Buffer.alloc(width * height * 4);
    const rows = [[172, 276], [290, 392], [406, 508], [522, 626], [638, 742], [754, 858]];
    for (const [start = 0, end = 0] of rows) {
      for (let y = start; y <= end; y += 1) {
        for (let x = 1495; x <= 1769; x += 1) {
          const offset = (y * width + x) * 4;
          bitmap[offset] = 90;
          bitmap[offset + 1] = 20;
          bitmap[offset + 2] = 185;
          bitmap[offset + 3] = 255;
        }
      }
      for (let y = start + 12; y <= end - 8; y += 1) {
        for (let x = 1550; x <= 1648; x += 1) {
          const offset = (y * width + x) * 4;
          bitmap[offset] = 60;
          bitmap[offset + 1] = 160;
          bitmap[offset + 2] = 210;
        }
      }
    }

    const detected = detectOpponentSlotRectsFromBgra(bitmap, width, height);
    expect(detected).toHaveLength(6);
    expect(detected[0]).toEqual({ x: 1530, y: 170, width: 143, height: 110 });
    expect(detected[5]).toEqual({ x: 1530, y: 752, width: 143, height: 110 });
  });

  it('폼 식별자가 정확하면 National Dex보다 PokeAPI 폼 ID를 사용한다', () => {
    expect(resolvePokeApiPokemonId(
      { name: 'Charizard-Mega-X', displayName: '메가리자몽X', nationalDex: 6 },
      [{ id: 6, identifier: 'charizard' }, { id: 10034, identifier: 'charizard-mega-x' }],
    )).toBe(10034);
  });

  it('기본 종 이름은 비슷한 변형 ID 대신 National Dex를 사용한다', () => {
    const species = { name: 'Mimikyu', displayName: '따라큐', nationalDex: 778 };
    const rows = [{ id: 10143, identifier: 'mimikyu-disguised' }, { id: 10144, identifier: 'mimikyu-busted' }];
    expect(resolvePokeApiPokemonId(species, rows)).toBe(778);
    expect(visionSeedSourceGroups(species, rows).map((group) => group.urls[0])).toEqual([
      expect.stringContaining('/generation-ix/scarlet-violet/778.png'),
      expect.stringContaining('/other/home/778.png'),
      expect.stringContaining('/generation-viii/icons/778.png'),
    ]);
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
